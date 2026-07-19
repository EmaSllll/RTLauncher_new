use serde::{Deserialize, Serialize};
use std::{
    collections::{HashSet, HashMap},
    path::PathBuf,
    sync::{Mutex, OnceLock},
};
use std::env::consts::OS;
use os_info::Type;
use anyhow::Context;
use regex::Regex;
use std::{
    io::{BufRead, BufReader},
    process::{Command, Stdio, Child},
    thread,
};
use tauri::Emitter;

/// 全局游戏进程跟踪（存储 Child 所有权 + PID，便于 kill）
struct GameProcess {
    child: Option<Child>,
    pid: u32,
    fully_started: bool,
}

fn game_process_store() -> &'static Mutex<Option<GameProcess>> {
    static STORE: OnceLock<Mutex<Option<GameProcess>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(None))
}

/// 通过运行 java -XshowSettings:properties -version 动态获取 os.name 和 os.version
/// 某些 Linux 发行版（如 NixOS、Arch）下，Java 报告的 os.name 与 LWJGL 期望的值不匹配
fn detect_os_properties_from_java(java_path: &str) -> (Option<String>, Option<String>) {
    if java_path.is_empty() {
        return (None, None);
    }
    let output = match Command::new(java_path)
        .arg("-XshowSettings:properties")
        .arg("-version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(o) => o,
        Err(_) => return (None, None),
    };

    let stderr_text = String::from_utf8_lossy(&output.stderr).to_string();
    let stdout_text = String::from_utf8_lossy(&output.stdout).to_string();

    let mut os_name: Option<String> = None;
    let mut os_version: Option<String> = None;

    for text in [&stderr_text, &stdout_text] {
        for line in text.lines() {
            let trimmed = line.trim();
            if os_name.is_none() {
                if let Some(rest) = trimmed.strip_prefix("os.name") {
                    let value = rest.trim().trim_start_matches('=').trim();
                    if !value.is_empty() {
                        os_name = Some(value.to_string());
                    }
                }
            }
            if os_version.is_none() {
                if let Some(rest) = trimmed.strip_prefix("os.version") {
                    let value = rest.trim().trim_start_matches('=').trim();
                    if !value.is_empty() {
                        os_version = Some(value.to_string());
                    }
                }
            }
            if os_name.is_some() && os_version.is_some() {
                break;
            }
        }
        if os_name.is_some() && os_version.is_some() {
            break;
        }
    }
    (os_name, os_version)
}

/// 检测游戏是否完全启动（JVM 启动、加载完资源、主窗口就绪）
fn is_game_fully_started(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.contains("minecraft client started")
        || lower.contains("minecraft is ready to start")
        || lower.contains("preparing spawn area")
        || lower.contains("minecraft initialized")
        || lower.contains("launching game")
        || (lower.contains("loading complete") && lower.contains("mod"))
        || lower.contains("minecraft client has started")
}

#[derive(Debug, Clone, Serialize)]
struct GameLogEvent {
    level: String,
    message: String,
}

/// 解析 Minecraft log4j 日志行，提取日志级别
fn parse_log_level(line: &str) -> &'static str {
    if let Some(start) = line.find('[') {
        if let Some(end) = line[start..].find(']') {
            let tag = &line[start + 1..start + end];
            if let Some(slash) = tag.rfind('/') {
                let level = &tag[slash + 1..];
                match level.to_uppercase().as_str() {
                    "ERROR" | "FATAL" => return "error",
                    "WARN" | "WARNING" => return "warn",
                    _ => {}
                }
            }
        }
    }
    let u = line.to_uppercase();
    if u.contains("[ERROR]") || u.contains("[FATAL]") || u.contains("STDERR:") {
        "error"
    } else if u.contains("[WARN]") || u.contains("[WARNING]") {
        "warn"
    } else {
        "info"
    }
}

/// 清理参数中的空格，保持参数纯净
fn clean_param_spaces(param: &str) -> String {
    param.trim().to_string()
}

/// 为离线玩家生成稳定的 UUID（基于玩家名称）
fn offline_uuid(player_name: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let input = format!("OfflinePlayer:{}", player_name);
    let mut h1 = DefaultHasher::new();
    input.hash(&mut h1);
    let hi = h1.finish();
    let mut h2 = DefaultHasher::new();
    format!("{}:salt", input).hash(&mut h2);
    let lo = h2.finish();
    let hi = (hi & 0xFFFFFFFF_FFFF0FFF) | 0x00000000_00003000;
    let lo = (lo & 0x3FFFFFFF_FFFFFFFF) | 0x80000000_00000000;
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        (hi >> 32) as u32,
        (hi >> 16) as u16 & 0xFFFF,
        hi as u16 & 0xFFFF,
        (lo >> 48) as u16 & 0xFFFF,
        lo & 0x0000FFFFFFFFFFFF
    )
}

fn is_valid_uuid(s: &str) -> bool {
    let trimmed = s.replace('-', "");
    trimmed.len() == 32 && trimmed.chars().all(|c| c.is_ascii_hexdigit())
}

fn library_name_to_path(name: &str) -> Option<String> {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() >= 3 {
        let group = parts[0].replace('.', "/");
        let artifact = parts[1];
        let version = parts[2];
        Some(format!("{}/{}/{}/{}-{}.jar", group, artifact, version, artifact, version))
    } else {
        None
    }
}

fn parse_library_path(path: &str) -> Option<(String, String, String)> {
    let path_without_ext = path.strip_suffix(".jar")?;
    let parts: Vec<&str> = path_without_ext.split('/').collect();
    if parts.len() >= 4 {
        let group = parts[..parts.len()-3].join("/");
        let artifact = parts[parts.len()-3];
        let version = parts[parts.len()-2];
        let expected_filename = format!("{}-{}", artifact, version);
        if parts[parts.len()-1] == expected_filename {
            Some((group, artifact.to_string(), version.to_string()))
        } else {
            None
        }
    } else {
        None
    }
}

fn compare_versions(version1: &str, version2: &str) -> bool {
    let v1_parts: Vec<&str> = version1.split('.').collect();
    let v2_parts: Vec<&str> = version2.split('.').collect();
    for i in 0..std::cmp::max(v1_parts.len(), v2_parts.len()) {
        let v1_part = v1_parts.get(i).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
        let v2_part = v2_parts.get(i).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
        if v1_part > v2_part {
            return true;
        } else if v1_part < v2_part {
            return false;
        }
    }
    false
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionJson {
    arguments: Option<Arguments>,
    main_class: String,
    libraries: Vec<Library>,
    #[serde(rename = "inheritsFrom")]
    parent_version: Option<String>,
    logging: Option<Logging>,
    minecraft_arguments: Option<String>,
    asset_index: Option<AssetIndex>,
}

#[derive(Debug, Deserialize)]
struct AssetIndex {
    id: String,
}

#[derive(Debug, Deserialize)]
struct Logging {
    client: Option<LoggingClient>,
}

#[derive(Debug, Deserialize)]
struct LoggingClient {
    file: LogFile,
}

#[derive(Debug, Deserialize)]
struct LogFile {
    id: String,
}

#[derive(Debug, Deserialize, Clone)]
struct Arguments {
    jvm: Option<Vec<JvmArgument>>,
    game: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
enum JvmArgument {
    String(String),
    Object { rules: Vec<Rule>, value: serde_json::Value },
}

#[derive(Debug, Deserialize, Clone)]
struct Rule {
    #[serde(rename = "action")]
    action: String,
    #[serde(default)]
    os: Option<OsRule>,
}

#[derive(Debug, Deserialize, Clone)]
struct OsRule {
    name: Option<String>,
    arch: Option<String>,
    version: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Library {
    name: String,
    #[serde(default)]
    downloads: LibraryDownloads,
    #[serde(default)]
    rules: Vec<Rule>,
    #[serde(default)]
    natives: HashMap<String, String>,
    #[serde(default)]
    serverreq: bool,
}

#[derive(Debug, Deserialize, Default)]
struct LibraryDownloads {
    artifact: Option<Artifact>,
    #[serde(default)]
    classifiers: HashMap<String, Artifact>,
}

#[derive(Debug, Deserialize)]
struct Artifact {
    path: String,
    url: String,
    sha1: String,
    size: u64,
}

fn check_rules(rules: &[Rule], os_info: &os_info::Info, os_arch: &str) -> bool {
    let mut allowed = true;
    for rule in rules {
        let mut rule_matched = false;
        if let Some(os_rule) = &rule.os {
            let os_match = match os_rule.name.as_deref() {
                Some("windows") => os_info.os_type() == Type::Windows,
                Some("osx") => os_info.os_type() == Type::Macos,
                Some("linux") => os_info.os_type() == Type::Linux,
                _ => true,
            };
            let arch_match = match os_rule.arch.as_deref() {
                Some("x86") => os_arch.contains("x86") || (cfg!(target_arch = "x86_64") && os_arch.contains("64")),
                Some(s) => os_arch.contains(s) || s.contains(os_arch),
                None => true,
            };
            let version_match = if let Some(version_pattern) = &os_rule.version {
                let re = Regex::new(version_pattern).unwrap();
                re.is_match(&os_info.version().to_string())
            } else {
                true
            };
            rule_matched = os_match && arch_match && version_match;
        }
        match rule.action.as_str() {
            "allow" => allowed = rule_matched,
            "disallow" => allowed = !rule_matched,
            _ => {}
        }
    }
    allowed
}

pub fn run_command(args: Vec<String>, java_path: PathBuf, mc_path: PathBuf, app_handle: tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if !java_path.exists() {
        return Err(format!("Java 路径不存在: {}", java_path.display()).into());
    }
    if let Some(ext) = java_path.extension() {
        if ext.eq_ignore_ascii_case("jar") {
            return Err(format!(
                "Java 路径指向了一个 .jar 文件而非 Java 可执行文件: {}\n请设置为 java 或 javaw 可执行文件的路径，例如 /usr/bin/java",
                java_path.display()
            ).into());
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = std::fs::metadata(&java_path)
            .map_err(|e| format!("无法读取 Java 文件信息: {}", e))?;
        let permissions = metadata.permissions();
        if permissions.mode() & 0o111 == 0 {
            println!("Java 缺少执行权限，正在修复: {}", java_path.display());
            let mut new_perms = permissions.clone();
            new_perms.set_mode(permissions.mode() | 0o755);
            std::fs::set_permissions(&java_path, new_perms)
                .map_err(|e| format!("无法设置 Java 执行权限: {}", e))?;
        }
    }
    if !mc_path.exists() {
        std::fs::create_dir_all(&mc_path)
            .map_err(|e| format!("无法创建游戏目录 {}: {}", mc_path.display(), e))?;
    }

    let mut command = match OS {
        "windows" | "linux" | "macos" => Command::new(&java_path),
        _ => return Err("不支持的操作系统".to_string().into()),
    };
    command.current_dir(&mc_path);
    command.args(&args);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    match command.spawn() {
        Ok(mut child) => {
            let pid = child.id();
            println!("游戏启动成功，进程ID: {}", pid);
            let stdout = child.stdout.take();
            let stderr = child.stderr.take();
            {
                let mut store = game_process_store().lock().unwrap();
                *store = Some(GameProcess {
                    child: Some(child),
                    pid,
                    fully_started: false,
                });
            }
            let fully_started_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

            if let Some(out) = stdout {
                let handle = app_handle.clone();
                let flag = fully_started_flag.clone();
                thread::spawn(move || {
                    let reader = BufReader::new(out);
                    for line in reader.lines() {
                        if let Ok(line) = line {
                            let level = parse_log_level(&line).to_string();
                            println!("[{}] {}", level, line);
                            let _ = handle.emit("game-log", GameLogEvent {
                                level: level.clone(),
                                message: line.clone(),
                            });
                            if !flag.load(std::sync::atomic::Ordering::SeqCst)
                                && is_game_fully_started(&line)
                            {
                                flag.store(true, std::sync::atomic::Ordering::SeqCst);
                                {
                                    let mut store = game_process_store().lock().unwrap();
                                    if let Some(gp) = store.as_mut() {
                                        gp.fully_started = true;
                                    }
                                }
                                let _ = handle.emit("game-fully-started", pid);
                            }
                        }
                    }
                });
            }
            if let Some(err) = stderr {
                let handle = app_handle.clone();
                let flag = fully_started_flag.clone();
                thread::spawn(move || {
                    let reader = BufReader::new(err);
                    for line in reader.lines() {
                        if let Ok(line) = line {
                            let level = parse_log_level(&line).to_string();
                            println!("[{}] {}", level, line);
                            let _ = handle.emit("game-log", GameLogEvent {
                                level: level.clone(),
                                message: line.clone(),
                            });
                            if !flag.load(std::sync::atomic::Ordering::SeqCst)
                                && is_game_fully_started(&line)
                            {
                                flag.store(true, std::sync::atomic::Ordering::SeqCst);
                                {
                                    let mut store = game_process_store().lock().unwrap();
                                    if let Some(gp) = store.as_mut() {
                                        gp.fully_started = true;
                                    }
                                }
                                let _ = handle.emit("game-fully-started", pid);
                            }
                        }
                    }
                });
            }
            thread::spawn(move || {
                let child_to_wait = {
                    let mut store = game_process_store().lock().unwrap();
                    store.as_mut().and_then(|gp| gp.child.take())
                };
                let exit_code = if let Some(mut c) = child_to_wait {
                    match c.wait() {
                        Ok(status) => status.code().unwrap_or(-1),
                        Err(e) => {
                            println!("等待游戏进程 {} 时出错: {}", pid, e);
                            -1
                        }
                    }
                } else {
                    -1
                };
                println!("游戏进程 {} 已结束，退出码: {}", pid, exit_code);
                {
                    let mut store = game_process_store().lock().unwrap();
                    *store = None;
                }
                let _ = app_handle.emit("game-exited", exit_code);
            });
            Ok(())
        }
        Err(e) => {
            let msg = format!(
                "游戏启动失败 (Java: {}): {}",
                java_path.display(),
                e
            );
            println!("{}", msg);
            Err(msg.into())
        }
    }
}

#[tauri::command]
pub fn kill_game_process() -> Result<String, String> {
    let mut store = game_process_store().lock().map_err(|e| e.to_string())?;
    let process_info = match store.as_mut() {
        Some(gp) => {
            let pid = gp.pid;
            let started = gp.fully_started;
            let result = if let Some(c) = gp.child.as_mut() {
                c.kill().map(|_| ()).map_err(|e| e.to_string())
            } else {
                Err("没有进程句柄".to_string())
            };
            if result.is_err() {
                #[cfg(windows)]
                {
                    let _ = std::process::Command::new("taskkill")
                        .args(["/F", "/PID", &pid.to_string()])
                        .output();
                }
                #[cfg(not(windows))]
                {
                    let _ = std::process::Command::new("kill")
                        .args(["-9", &pid.to_string()])
                        .output();
                }
            }
            Some((pid, started))
        }
        None => None,
    };
    *store = None;
    match process_info {
        Some((pid, started)) => {
            if started {
                Ok(format!("游戏进程 (PID {}) 已终止", pid))
            } else {
                Ok(format!("启动中的游戏进程 (PID {}) 已取消", pid))
            }
        }
        None => Err("当前没有运行中的游戏进程".to_string()),
    }
}

// =====================================================================
// 以下为重构后的启动参数构建系统
// 设计参考 HMCL 官方 GitHub 仓库的三阶段设计：
// 阶段 1: 加载版本配置（含继承）
// 阶段 2: 构建 classpath（库、原生库）
// 阶段 3: 构建 JVM 参数 + 游戏参数 + 主类
// =====================================================================

/// 从 version.json 的解析并合并 parent 的继承链，合并后的完整版本配置
struct ResolvedVersion {
    version_json: VersionJson,
    parent_version: Option<String>,
}

fn load_version_chain(minecraft_path: &PathBuf, version_name: &str) -> anyhow::Result<ResolvedVersion> {
    let version_path = minecraft_path
        .join("versions")
        .join(version_name)
        .join(format!("{}.json", version_name));
    let mut version_json: VersionJson = serde_json::from_reader(
        std::fs::File::open(&version_path).with_context(|| format!("无法打开版本配置文件: {}", version_path.display()))?
    ).with_context(|| format!("解析版本配置失败: {}", version_path.display()))?;

    let parent_version = version_json.parent_version.clone();

    if let Some(parent) = &version_json.parent_version {
        let parent_path = minecraft_path
            .join("versions")
            .join(parent)
            .join(format!("{}.json", parent));
        let parent_json: VersionJson = serde_json::from_reader(
            std::fs::File::open(&parent_path).with_context(|| format!("无法打开父版本配置: {}", parent_path.display()))?
        ).with_context(|| format!("解析父版本配置失败: {}", parent_path.display()))?;

        if version_json.asset_index.is_none() {
            version_json.asset_index = parent_json.asset_index;
        }
        if version_json.logging.is_none() {
            version_json.logging = parent_json.logging;
        }
        if version_json.arguments.is_none() && parent_json.arguments.is_some() {
            version_json.arguments = parent_json.arguments;
        }
        if version_json.minecraft_arguments.is_none() && parent_json.minecraft_arguments.is_some() {
            version_json.minecraft_arguments = parent_json.minecraft_arguments;
        }

        let mut seen: HashSet<String> = HashSet::new();
        for lib in &version_json.libraries {
            seen.insert(lib.name.clone());
        }
        for parent_lib in parent_json.libraries {
            if !seen.contains(&parent_lib.name) {
                version_json.libraries.push(parent_lib);
            }
        }
    }

    Ok(ResolvedVersion { version_json, parent_version })
}

fn normalize_path(p: &PathBuf) -> String {
    p.to_string_lossy().replace('\\', "/")
}

/// 构建 classpath（库路径列表，返回 (库文件路径列表，使用操作系统适配
fn build_classpath(
    minecraft_path: &PathBuf,
    resolved: &ResolvedVersion,
    os_info: &os_info::Info,
    os_arch: &str,
    uses_module_system: bool,
    version_name: &str,
) -> anyhow::Result<Vec<String>> {
    let mut entries: Vec<String> = Vec::new();
    let VersionJson { libraries, .. } = &resolved.version_json;
    for lib in libraries {
        let allowed = check_rules(&lib.rules, os_info, os_arch) || lib.serverreq;
        if !allowed {
            continue;
        }

        // 优先使用 downloads 中的 artifact 或 classifiers 作为 classpath
        let artifact_path = if !lib.downloads.classifiers.is_empty() {
            // 选择适合当前平台的 classifier（优先 natives 分类器
            let native_keys: &[&str] = match os_info.os_type() {
                Type::Windows => &["windows"],
                Type::Macos => &["macos", "osx"],
                Type::Linux => &["linux"],
                _ => return Err(anyhow::anyhow!("不支持的操作系统")),
            };
            let mut found: Option<String> = None;
            for key in native_keys {
                if let Some(native_val) = lib.natives.get(*key) {
                    let processed = native_val.replace("${arch}", os_arch);
                    if let Some(stripped) = processed.strip_prefix("natives-") {
                        if lib.downloads.classifiers.contains_key(stripped) {
                            found = Some(stripped.to_string());
                            break;
                        }
                    } else if lib.downloads.classifiers.contains_key(&processed) {
                        found = Some(processed);
                        break;
                    }
                }
            }
            if found.is_none() {
                let fallback_classifiers: Vec<&str> = match os_info.os_type() {
                    Type::Windows => {
                        if os_arch.contains("64") {
                            vec!["windows-x86_64", "windows-amd64", "windows"]
                        } else {
                            vec!["windows-x86", "windows"]
                        }
                    }
                    Type::Macos => {
                        if os_arch.contains("aarch64") || os_arch.contains("arm") {
                            vec!["macos-aarch64", "osx-aarch64", "macos", "osx"]
                        } else {
                            vec!["macos-x86_64", "osx-x86_64", "macos", "osx"]
                        }
                    }
                    Type::Linux => {
                        if os_arch.contains("aarch64") || os_arch.contains("arm") {
                            vec!["linux-aarch64", "linux-arm64", "linux"]
                        } else {
                            vec!["linux-x86_64", "linux-amd64", "linux"]
                        }
                    }
                    _ => vec!["linux"],
                };
                for fc in fallback_classifiers {
                    let stripped = fc.strip_prefix("natives-").unwrap_or(fc);
                    if lib.downloads.classifiers.contains_key(stripped) {
                        found = Some(stripped.to_string());
                        break;
                    }
                }
            }
            let classifier = found.ok_or_else(|| anyhow::anyhow!("未找到平台匹配的 natives 库: {}", lib.name))?;
            lib.downloads.classifiers.get(&classifier)
                .map(|a| minecraft_path.join("libraries").join(&a.path))
        } else if lib.downloads.artifact.is_some() {
            lib.downloads.artifact.as_ref()
                .map(|a| minecraft_path.join("libraries").join(&a.path))
        } else {
            library_name_to_path(&lib.name).map(|p| minecraft_path.join("libraries").join(p))
        };

        // 处理 -SNAPSHOT 版本
        let resolved_path = match artifact_path {
            Some(mut full) => {
                if !full.exists() && lib.name.contains("-SNAPSHOT") {
                    if let Some(parent) = full.parent() {
                        if let Ok(entries) = std::fs::read_dir(parent) {
                            let name_parts: Vec<&str> = lib.name.split(':').collect();
                            if name_parts.len() >= 2 {
                                for entry in entries.flatten() {
                                    let p = entry.path();
                                    if let Some(ext) = p.extension() {
                                        if ext == "jar" {
                                            if let Some(fname) = p.file_name() {
                                                let s = fname.to_string_lossy();
                                                if s.starts_with(name_parts[1]) {
                                                    full = p;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Some(full)
            }
            None => None,
        };

        if let Some(p) = resolved_path {
            entries.push(normalize_path(&p));
        }
    }

    // 验证 classpath 中的每个文件是否存在
    {
        let mut missing: Vec<String> = Vec::new();
        for entry in &entries {
            let pb = PathBuf::from(entry);
            if !pb.exists() {
                missing.push(entry.clone());
            } else if let Ok(meta) = std::fs::metadata(&pb) {
                if meta.len() == 0 {
                    missing.push(format!("{} (空文件)", entry));
                }
            }
        }
        if !missing.is_empty() {
            let error_msg = format!("classpath 中以下文件不存在或为空:\n{}", missing.join("\n"));
            println!("[错误] {}", error_msg);
            return Err(anyhow::anyhow!("{}", error_msg));
        }
    }

    // 对于使用模块系统的版本，不将原版 minecraft jar 加入 classpath
    if !uses_module_system {
        let vanilla_jar = normalize_path(&minecraft_path
            .join("versions")
            .join(version_name)
            .join(format!("{}.jar", version_name)));
        entries.push(vanilla_jar);
    }

    Ok(entries)
}

/// 从 arguments.jvm 或 arguments.game 中提取参数，按规则过滤并替换占位符
fn resolve_jvm_arguments(
    args: Option<&Vec<JvmArgument>>,
    placeholder_replacer: &dyn Fn(&str) -> String,
    os_info: &os_info::Info,
    os_arch: &str,
) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    if let Some(jvm_args) = args {
        for arg in jvm_args {
            match arg {
                JvmArgument::String(s) => {
                    let replaced = placeholder_replacer(s);
                    if !replaced.trim().is_empty() {
                        result.push(replaced.trim().to_string());
                    }
                }
                JvmArgument::Object { rules, value } => {
                    if check_rules(rules, os_info, os_arch) {
                        match value {
                            serde_json::Value::String(s) => {
                                let replaced = placeholder_replacer(s);
                                if !replaced.trim().is_empty() {
                                    result.push(replaced.trim().to_string());
                                }
                            }
                            serde_json::Value::Array(arr) => {
                                for item in arr {
                                    if let Some(s) = item.as_str() {
                                        let replaced = placeholder_replacer(s);
                                        if !replaced.trim().is_empty() {
                                            result.push(replaced.trim().to_string());
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }
    result
}

fn resolve_game_arguments(
    args: Option<&Vec<serde_json::Value>>,
    minecraft_args: Option<&String>,
    placeholder_replacer: &dyn Fn(&str) -> String,
    os_info: &os_info::Info,
    os_arch: &str,
) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    if let Some(game_args) = args {
        for arg in game_args {
            match arg {
                serde_json::Value::String(s) => {
                    let replaced = placeholder_replacer(s);
                    if !replaced.trim().is_empty() {
                        result.push(replaced.trim().to_string());
                    }
                }
                serde_json::Value::Array(arr) => {
                    for item in arr {
                        if let Some(s) = item.as_str() {
                            let replaced = placeholder_replacer(s);
                            if !replaced.trim().is_empty() {
                                result.push(replaced.trim().to_string());
                            }
                        }
                    }
                }
                serde_json::Value::Object(obj) => {
                    if let Some(rules_val) = obj.get("rules") {
                        if let Some(rules_arr) = rules_val.as_array() {
                            let rules: Vec<Rule> = rules_arr
                                .iter()
                                .filter_map(|r| serde_json::from_value::<Rule>(r.clone()).ok())
                                .collect();
                            if !check_rules(&rules, os_info, os_arch) {
                                continue;
                            }
                        }
                    }
                    if let Some(val) = obj.get("value") {
                        match val {
                            serde_json::Value::String(s) => {
                                let replaced = placeholder_replacer(s);
                                if !replaced.trim().is_empty() {
                                    result.push(replaced.trim().to_string());
                                }
                            }
                            serde_json::Value::Array(arr) => {
                                for item in arr {
                                    if let Some(s) = item.as_str() {
                                        let replaced = placeholder_replacer(s);
                                        if !replaced.trim().is_empty() {
                                            result.push(replaced.trim().to_string());
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
    } else if let Some(mca) = minecraft_args {
        for token in mca.split_whitespace() {
            let replaced = placeholder_replacer(token);
            if !replaced.trim().is_empty() {
                result.push(replaced.trim().to_string());
            }
        }
    }
    result
}

/// 构建完整的 JVM 启动参数，按照 HMCL 的三阶段设计
fn build_jvm_arguments_inner(
    _app_handle: tauri::AppHandle,
    minecraft_path: &str,
    java_path: &str,
    wrapper_path: &str,
    max_memory: &str,
    version_name: &str,
    player_name: &str,
    auth_token: &str,
    uuid: &str,
    authlib_injector_path: &str,
    yggdrasil_api: &str,
    prefetched_data: &str,
    load_type: &str,
    load_name: &str,
    window_width: &str,
    window_height: &str,
) -> anyhow::Result<Vec<String>> {
    let minecraft_path_buf = PathBuf::from(minecraft_path);
    let os_info = os_info::get();
    let os_arch_raw = std::env::consts::ARCH.to_string();
    let is_windows = os_info.os_type() == Type::Windows;
    let is_macos = os_info.os_type() == Type::Macos;

    // ===== 阶段 1: 加载版本配置（含继承）
    let resolved = load_version_chain(&minecraft_path_buf, version_name)?;

    // 判断是否使用 Java 模块系统（Forge 1.17+ / NeoForge）
    let main_class_lc = resolved.version_json.main_class.to_lowercase();
    let uses_module_system = resolved.version_json.libraries.iter().any(|lib| {
        lib.name.contains(":fmlloader:") || lib.name.contains(":bootstraplauncher:")
    }) || main_class_lc.contains("bootstraplauncher")
        || main_class_lc.contains("modlauncher")
        || main_class_lc.contains("cpw.mods")
        || main_class_lc.contains("fml");

    // ===== 阶段 2: 构建 classpath
    let classpath_entries = build_classpath(
        &minecraft_path_buf,
        &resolved,
        &os_info,
        &os_arch_raw,
        uses_module_system,
        version_name,
    )?;
    let classpath_sep = if is_windows { ";" } else { ":" };
    let classpath_str = classpath_entries.join(classpath_sep);

    // ===== 处理 UUID / Token =====
    let effective_uuid = if uuid.trim().is_empty() || !is_valid_uuid(uuid) {
        offline_uuid(player_name)
    } else {
        uuid.to_string()
    };
    let effective_token = if auth_token.trim().is_empty() {
        "0".to_string()
    } else {
        auth_token.to_string()
    };

    let assets_dir = normalize_path(&minecraft_path_buf.join("assets"));
    let natives_dir = normalize_path(
        &minecraft_path_buf
            .join("versions")
            .join(version_name)
            .join(format!("{}-natives", version_name)),
    );
    let game_dir = normalize_path(
        &minecraft_path_buf
            .join("versions")
            .join(if load_type != "0" && !load_name.is_empty() { load_name } else { version_name }),
    );
    let asset_index_id = resolved.version_json.asset_index.as_ref().map(|a| a.id.trim().to_string()).unwrap_or_default();

    // 游戏参数占位符替换器
    let game_placeholder_replacer = |s: &str| -> String {
        s.replace("${auth_player_name}", player_name)
         .replace("${auth_session}", &effective_token)
         .replace("${auth_access_token}", &effective_token)
         .replace("${auth_uuid}", &effective_uuid)
         .replace("${user_properties}", r#"{"issuer":["Mojang"]}"#)
         .replace("${version_name}", version_name)
         .replace("${natives_directory}", &natives_dir)
         .replace("${game_directory}", &game_dir)
         .replace("${assets_root}", &assets_dir)
         .replace("${assets_index_name}", &asset_index_id)
         .replace("${user_type}", "msa")
         .replace("${version_type}", "RTL")
    };

    // JVM 参数占位符替换器
    let library_dir = normalize_path(&minecraft_path_buf.join("libraries"));
    let jvm_placeholder_replacer = |s: &str| -> String {
        let mut result = s.to_string();
        result = result.replace("${classpath_separator}", classpath_sep);
        result = result.replace("${library_directory}", &library_dir);
        result = result.replace("${classpath}", &classpath_str);
        result = result.replace("${version_name}", version_name);
        result.trim().to_string()
    };

    // ===== 阶段 3: 构建 JVM 参数
    let mut args: Vec<String> = Vec::new();

    // === 3.1 内存参数
    args.push("-Xmn768m".to_string());
    args.push(format!("-Xmx{}m", max_memory));

    // === 3.2 平台特有参数（参考 HMCL 官方三平台设计
    if is_macos {
        args.push("-XstartOnFirstThread".to_string());
    }
    if os_info.architecture().map_or(false, |a| a.contains("x86")) {
        args.push("-Xss1M".to_string());
    }
    if is_windows {
        args.push("-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump".to_string());
    }

    // === 3.3 GC 与模块访问参数
    args.extend(vec![
        "-XX:+UseG1GC".to_string(),
        "-XX:-UseAdaptiveSizePolicy".to_string(),
        "-XX:-OmitStackTraceInFastThrow".to_string(),
        "-Djdk.lang.Process.allowAmbiguousCommands=true".to_string(),
        "-Dfml.ignoreInvalidMinecraftCertificates=True".to_string(),
        "-Dfml.ignorePatchDiscrepancies=True".to_string(),
        // 标准 Java 模块访问权限（适用于 Java 9+）
        "--add-opens=java.base/java.lang=ALL-UNNAMED".to_string(),
        "--add-opens=java.base/java.lang.invoke=ALL-UNNAMED".to_string(),
        "--add-opens=java.base/java.lang.reflect=ALL-UNNAMED".to_string(),
        "--add-opens=java.base/java.net=ALL-UNNAMED".to_string(),
        "--add-opens=java.base/java.nio=ALL-UNNAMED".to_string(),
        "--add-opens=java.base/java.util=ALL-UNNAMED".to_string(),
        "--add-opens=java.base/java.util.concurrent=ALL-UNNAMED".to_string(),
        "--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED".to_string(),
        "--add-opens=java.base/jdk.internal.misc=ALL-UNNAMED".to_string(),
        "--add-opens=java.base/sun.nio.ch=ALL-UNNAMED".to_string(),
        "--add-opens=java.base/sun.security.util=ALL-UNNAMED".to_string(),
        "--add-opens=java.base/sun.security.x509=ALL-UNNAMED".to_string(),
        "--add-opens=java.base/sun.net.www.protocol.jar=ALL-UNNAMED".to_string(),
        "--add-exports=java.base/sun.nio.ch=ALL-UNNAMED".to_string(),
        "--add-exports=java.base/jdk.internal.misc=ALL-UNNAMED".to_string(),
        "--add-exports=java.base/sun.security.util=ALL-UNNAMED".to_string(),
        "--add-exports=java.desktop/sun.awt=ALL-UNNAMED".to_string(),
        "--add-exports=java.desktop/sun.java2d=ALL-UNNAMED".to_string(),
    ]);

    // === 3.4 日志配置
    if let Some(logging) = &resolved.version_json.logging {
        if let Some(client) = &logging.client {
            let mut log_file_path = minecraft_path_buf
                .join("versions")
                .join(version_name)
                .join(&client.file.id);
            if !log_file_path.exists() {
                if let Some(pv) = &resolved.parent_version {
                    let parent_file = minecraft_path_buf
                        .join("versions")
                        .join(pv)
                        .join(&client.file.id);
                    if parent_file.exists() {
                        log_file_path = parent_file;
                    }
                }
            }
            let log_path = normalize_path(&log_file_path);
            args.push(format!("-Dlog4j.configurationFile=file:///{}", log_path));
        }
    }

    // === 3.5 os.name / os.version / os.arch 归一化（HMCL 标准做法）
    let (os_name_from_java, os_version_from_java) = detect_os_properties_from_java(java_path);
    let os_name_str = if let Some(ref name) = os_name_from_java {
        name.clone()
    } else {
        if is_windows {
            "Windows".to_string()
        } else if is_macos {
            "Mac OS X".to_string()
        } else {
            "Linux".to_string()
        }
    };
    let os_version_str = os_version_from_java.unwrap_or_else(|| os_info.version().to_string());
    let normalized_os_name = if is_windows {
        if os_name_str.to_lowercase().contains("win") {
            "Windows".to_string()
        } else {
            os_name_str
        }
    } else if is_macos {
        let lower = os_name_str.to_lowercase();
        if lower.contains("mac") || lower.contains("darwin") || lower.contains("os x") {
            "Mac OS X".to_string()
        } else {
            "Mac OS X".to_string()
        }
    } else {
        let lower = os_name_str.to_lowercase();
        if lower.contains("linux") {
            "Linux".to_string()
        } else {
            os_name_str
        }
    };
    let os_arch_str = if os_arch_raw.contains("aarch64") || os_arch_raw.contains("arm") {
        "aarch64".to_string()
    } else if os_arch_raw.contains("86_64") || os_arch_raw.contains("amd64") || os_arch_raw.contains("x64") {
        "x86_64".to_string()
    } else if os_arch_raw.contains("86") {
        "x86".to_string()
    } else {
        os_arch_raw.clone()
    };
    args.push(format!("-Dos.name={}", normalized_os_name));
    args.push(format!("-Dos.version={}", os_version_str));
    args.push(format!("-Dos.arch={}", os_arch_str));
    args.push(format!("-DlibraryDirectory={}", library_dir));
    args.push(format!("-Djava.library.path={}", natives_dir));
    if is_neoforge_from_loadname(load_type, load_name) {
        args.push(format!("-Djna.tmpdir={}", natives_dir));
        args.push(format!("-Dorg.lwjgl.system.SharedLibraryExtractPath={}", natives_dir));
        args.push(format!("-Dio.netty.native.workdir={}", natives_dir));
    }

    // === 3.6 Authlib Injector 与 Prefetched Data
    if !authlib_injector_path.is_empty() && !yggdrasil_api.is_empty() {
        args.push(format!("-javaagent:{}={}", authlib_injector_path, yggdrasil_api));
    }
    if !prefetched_data.is_empty() {
        args.push(format!("-Dauthlibinjector.yggdrasil.prefetched={}", prefetched_data));
    }

    // === 3.7 从 version.json 的 arguments.jvm 中提取 JVM 参数
    // 关键：HMCL 的 -p (--module-path)、-cp、--add-opens 等参数都定义在这里
    let jvm_args_from_version = resolve_jvm_arguments(
        resolved.version_json.arguments.as_ref().and_then(|a| a.jvm.as_ref()),
        &jvm_placeholder_replacer,
        &os_info,
        &os_arch_raw,
    );

    // 将 -p / -cp 等参数从 jvm_args_from_version 加入到 args
    // 注意：arguments.jvm 中包含的参数是 Minecraft/Forge/NeoForge 自己精心设计的，
    // 这些参数必须被正确加入到启动命令中
    //
    // 关键的 -p 和 -cp 是 Forge/NeoForge 模块系统启动的核心参数
    // 按照 HMCL 的做法，这些参数会替换 ${classpath} 等占位符
    // 我们直接使用这些参数，不做去重（避免覆盖关键参数）
    for arg in jvm_args_from_version {
        args.push(arg);
    }

    // === 3.8 classpath（关键：必须在 -p 之后加入，避免被覆盖）
    let forge_has_cp = args.iter().any(|a| a == "-cp" || a == "--class-path");
    // 检查是否已有模块路径（Forge/NeoForge 1.17+ 会提供），用于参考
    let _forge_has_module_path = args.iter().any(|a| a == "-p" || a == "--module-path");
    if !forge_has_cp {
        args.push("-cp".to_string());
        args.push(classpath_str.clone());
    }

    // === 3.9 Wrapper（可选）
    if !wrapper_path.is_empty() {
        let wrapper_abs = normalize_path(&PathBuf::from(wrapper_path));
        args.push("-jar".to_string());
        args.push(wrapper_abs);
    }

    // ===== 阶段 4: 构建游戏参数 =====
    let mut game_args = resolve_game_arguments(
        resolved.version_json.arguments.as_ref().and_then(|a| a.game.as_ref()),
        resolved.version_json.minecraft_arguments.as_ref(),
        &game_placeholder_replacer,
        &os_info,
        &os_arch_raw,
    );

    // 窗口尺寸参数
    game_args.extend(vec![
        "--width".to_string(),
        (if window_width.is_empty() { "873" } else { window_width }).to_string(),
        "--height".to_string(),
        (if window_height.is_empty() { "486" } else { window_height }).to_string(),
    ]);

    // ===== 阶段 5: 主类 =====
    args.push(resolved.version_json.main_class.clone());

    // ===== 阶段 6: 游戏参数 =====
    args.extend(game_args);

    // 调试输出
    println!("=== 启动参数列表 ({} 项) ===", args.len());
    for (i, a) in args.iter().enumerate() {
        println!("  [{}] {}", i, a);
    }
    println!("=== 参数列表结束 ===");

    Ok(args)
}

fn is_neoforge_from_loadname(load_type: &str, load_name: &str) -> bool {
    load_type != "0" && !load_name.is_empty() && load_name.to_lowercase().contains("neoforge")
}

#[tauri::command]
pub fn build_jvm_arguments(
    app: tauri::AppHandle,
    minecraft_path: &str,
    java_path: &str,
    wrapper_path: &str,
    max_memory: &str,
    version_name: &str,
    player_name: &str,
    auth_token: &str,
    uuid: &str,
    authlib_injector_path: &str,
    yggdrasil_api: &str,
    prefetched_data: &str,
    load_type: &str,
    load_name: &str,
    window_width: &str,
    window_height: &str,
) -> Result<String, String> {
    let args = build_jvm_arguments_inner(
        app, minecraft_path, java_path, wrapper_path, max_memory, version_name,
        player_name, auth_token, uuid, authlib_injector_path, yggdrasil_api,
        prefetched_data, load_type, load_name, window_width, window_height,
    ).map_err(|e| e.to_string())?;
    Ok(args.join("\n"))
}

#[tauri::command]
pub fn launch_game(
    app: tauri::AppHandle,
    minecraft_path: &str,
    java_path: &str,
    wrapper_path: &str,
    max_memory: &str,
    version_name: &str,
    player_name: &str,
    auth_token: &str,
    uuid: &str,
    authlib_injector_path: &str,
    yggdrasil_api: &str,
    prefetched_data: &str,
    load_type: &str,
    load_name: &str,
    window_width: &str,
    window_height: &str,
) -> Result<String, String> {
    let args = build_jvm_arguments_inner(
        app.clone(),
        minecraft_path, java_path, wrapper_path, max_memory, version_name,
        player_name, auth_token, uuid, authlib_injector_path, yggdrasil_api,
        prefetched_data, load_type, load_name, window_width, window_height,
    ).map_err(|e| e.to_string())?;
    let arg_string = args.join("\n");
    run_command(
        args,
        PathBuf::from(java_path),
        PathBuf::from(minecraft_path),
        app,
    ).map_err(|e| e.to_string())?;
    Ok(arg_string)
}