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

/// 检测游戏是否完全启动（JVM 启动、加载完资源、主窗口就绪）
/// 通过 Minecraft 日志中的标志性字符串判断
fn is_game_fully_started(line: &str) -> bool {
    // 原版 Minecraft: "Minecraft client started" / "Preparing spawn area" / "Minecraft initialized"
    // 常见 Mod 加载器: "mod loading complete" / "Minecraft is ready to start" / "Launching game"
    let lower = line.to_lowercase();
    lower.contains("minecraft client started")
        || lower.contains("minecraft is ready to start")
        || lower.contains("preparing spawn area")
        || lower.contains("minecraft initialized")
        || lower.contains("launching game")
        || lower.contains("loading complete") && lower.contains("mod")
        || lower.contains("minecraft client has started")
}

/// 游戏日志事件，发送给前端的结构体
#[derive(Debug, Clone, Serialize)]
struct GameLogEvent {
    level: String,
    message: String,
}

/// 解析 Minecraft log4j 日志行，提取日志级别
/// 支持格式: [HH:MM:SS] [Thread/LEVEL]: message
fn parse_log_level(line: &str) -> &'static str {
    // 查找 [XXX/LEVEL] 模式（log4j2 标准格式）
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
    // fallback: 全文扫描关键词
    let u = line.to_uppercase();
    if u.contains("[ERROR]") || u.contains("[FATAL]") || u.contains("STDERR:") {
        "error"
    } else if u.contains("[WARN]") || u.contains("[WARNING]") {
        "warn"
    } else {
        "info"
    }
}

/// 清理参数中的空格，将引号内的空格移除
/// 例如: "-DFabricMcEmu= net.minecraft.client.main.Main " -> "-DFabricMcEmu=net.minecraft.client.main.Main"
fn clean_param_spaces(param: &str) -> String {
    let trimmed = param.trim();
    // 检查参数是否被引号包围
    if (trimmed.starts_with('"') && trimmed.ends_with('"')) ||
       (trimmed.starts_with("'") && trimmed.ends_with("'")) {
        // 移除外层引号
        let inner = &trimmed[1..trimmed.len()-1];
        // 移除内部所有空格
        inner.chars().filter(|c| !c.is_whitespace()).collect()
    } else {
        // 没有引号，直接返回trim后的结果
        trimmed.to_string()
    }
}

/// 为离线玩家生成稳定的 UUID v3（基于玩家名称）
fn offline_uuid(player_name: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    // 使用 "OfflinePlayer:" + name 的 MD5 风格哈希生成确定性 UUID
    // 简化版：用两次哈希生成 128bit
    let input = format!("OfflinePlayer:{}", player_name);
    let mut h1 = DefaultHasher::new();
    input.hash(&mut h1);
    let hi = h1.finish();
    let mut h2 = DefaultHasher::new();
    format!("{}:salt", input).hash(&mut h2);
    let lo = h2.finish();
    // 设置版本位 (version 3) 和 variant 位
    let hi = (hi & 0xFFFFFFFF_FFFF0FFF) | 0x00000000_00003000; // version 3
    let lo = (lo & 0x3FFFFFFF_FFFFFFFF) | 0x80000000_00000000; // variant 10
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        (hi >> 32) as u32,
        (hi >> 16) as u16 & 0xFFFF,
        hi as u16 & 0xFFFF,
        (lo >> 48) as u16 & 0xFFFF,
        lo & 0x0000FFFFFFFFFFFF
    )
}

/// 检查是否是合法 UUID 格式
fn is_valid_uuid(s: &str) -> bool {
    // 支持 xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx 或无连字符 32位 hex
    let trimmed = s.replace('-', "");
    trimmed.len() == 32 && trimmed.chars().all(|c| c.is_ascii_hexdigit())
}

/// 将Maven库名称转换为文件系统路径
/// 例如: "net.minecraft:launchwrapper:1.12" -> "net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar"
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

/// 从库路径中提取库的标识信息（group, artifact, version）
/// 例如: "org/apache/commons/commons-lang3/3.3.2/commons-lang3-3.3.2.jar" -> ("org/apache/commons", "commons-lang3", "3.3.2")
fn parse_library_path(path: &str) -> Option<(String, String, String)> {
    // 移除.jar扩展名
    let path_without_ext = path.strip_suffix(".jar")?;

    // 分割路径
    let parts: Vec<&str> = path_without_ext.split('/').collect();
    if parts.len() >= 4 {
        // 路径格式: group/artifact/version/artifact-version
        let group = parts[..parts.len()-3].join("/");
        let artifact = parts[parts.len()-3];
        let version = parts[parts.len()-2];

        // 验证artifact-version格式
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

/// 比较两个版本号，返回true如果version1 > version2
/// 简单版本比较，不支持语义化版本的所有特性
fn compare_versions(version1: &str, version2: &str) -> bool {
    // 分割版本号
    let v1_parts: Vec<&str> = version1.split('.').collect();
    let v2_parts: Vec<&str> = version2.split('.').collect();

    // 逐个比较版本号部分
    for i in 0..std::cmp::max(v1_parts.len(), v2_parts.len()) {
        let v1_part = v1_parts.get(i).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
        let v2_part = v2_parts.get(i).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);

        if v1_part > v2_part {
            return true;
        } else if v1_part < v2_part {
            println!("liteloader是{}, forge是{}",version1,version2);
            return false;
        }
    }

    // 版本号相同
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

#[derive(Debug, Deserialize)]
struct Arguments {
    jvm: Option<Vec<JvmArgument>>,
    game: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum JvmArgument {
    String(String),
    Object { rules: Vec<Rule>, value: serde_json::Value },
}

#[derive(Debug, Deserialize)]
struct Rule {
    #[serde(rename = "action")]
    action: String,
    #[serde(default)]
    os: Option<OsRule>,
}

#[derive(Debug, Deserialize)]
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

pub fn run_command(args: Vec<String>, javaPath: PathBuf, MCPath: PathBuf, app_handle: tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // 检查 Java 路径是否存在
    if !javaPath.exists() {
        return Err(format!("Java 路径不存在: {}", javaPath.display()).into());
    }

    // 校验 java_path 不是一个 .jar 文件
    if let Some(ext) = javaPath.extension() {
        if ext.eq_ignore_ascii_case("jar") {
            return Err(format!(
                "Java 路径指向了一个 .jar 文件而非 Java 可执行文件: {}\n请设置为 java 或 javaw 可执行文件的路径，例如 /usr/bin/java",
                javaPath.display()
            ).into());
        }
    }

    // 在 Unix 系统上检查并修复执行权限
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = std::fs::metadata(&javaPath)
            .map_err(|e| format!("无法读取 Java 文件信息: {}", e))?;
        let permissions = metadata.permissions();
        if permissions.mode() & 0o111 == 0 {
            println!("Java 缺少执行权限，正在修复: {}", javaPath.display());
            let mut new_perms = permissions.clone();
            new_perms.set_mode(permissions.mode() | 0o755);
            std::fs::set_permissions(&javaPath, new_perms)
                .map_err(|e| format!("无法设置 Java 执行权限: {}", e))?;
        }
    }

    // 确保工作目录存在
    if !MCPath.exists() {
        std::fs::create_dir_all(&MCPath)
            .map_err(|e| format!("无法创建游戏目录 {}: {}", MCPath.display(), e))?;
    }

    let mut command = match OS {
        "windows" | "linux" | "macos" => Command::new(&javaPath),
        _ => return Err("不支持的操作系统".to_string().into()),
    };
    command.current_dir(&MCPath);
    command.args(&args);
    // 捕获标准输出和错误输出以便转发日志到前端
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    match command.spawn() {
        Ok(mut child) => {
            let pid = child.id();
            println!("游戏启动成功，进程ID: {}", pid);

            // 从子进程取出 stdout/stderr 管道
            let stdout = child.stdout.take();
            let stderr = child.stderr.take();

            // 存储到全局进程表（启动中，尚未完成初始化）
            {
                let mut store = game_process_store().lock().unwrap();
                *store = Some(GameProcess {
                    child: Some(child),
                    pid,
                    fully_started: false,
                });
            }

            // 用于检测"完全启动"的共享 flag
            let fully_started_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

            // 读取 stdout 并逐行转发给前端
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
                            // 检测游戏是否已完全启动
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

            // 读取 stderr 并逐行转发给前端（通常为错误/警告信息）
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
                            // 同样在 stderr 中检测启动完成（有些启动日志走 stderr）
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

            // 在后台线程中等待进程结束，结束时向前端发送事件
            thread::spawn(move || {
                // 从全局 store 中取出 child 所有权以 wait
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

                // 清空全局进程表
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
                javaPath.display(),
                e
            );
            println!("{}", msg);
            Err(msg.into())
        }
    }
}

/// 终止当前游戏进程（在游戏未完全启动前可调用）
#[tauri::command]
pub fn kill_game_process() -> Result<String, String> {
    let mut store = game_process_store().lock().map_err(|e| e.to_string())?;

    let process_info = match store.as_mut() {
        Some(gp) => {
            let pid = gp.pid;
            let started = gp.fully_started;
            // 尝试直接 kill
            let result = if let Some(c) = gp.child.as_mut() {
                c.kill().map(|_| ()).map_err(|e| e.to_string())
            } else {
                Err("没有进程句柄".to_string())
            };

            // 跨平台兜底：如果 child.kill() 失败，用系统命令 kill
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

    // 清空 store
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
    loadType: &str,
    loadName: &str,
    window_width: &str,
    window_height: &str
) -> Result<String, String> {
    build_jvm_arguments_inner(
        app, minecraft_path, java_path, wrapper_path, max_memory, version_name,
        player_name, auth_token, uuid, authlib_injector_path, yggdrasil_api,
        prefetched_data, loadType, loadName, window_width, window_height,
    ).map_err(|e| e.to_string())
}

fn build_jvm_arguments_inner(
    _app_handle: tauri::AppHandle,
    minecraft_path: &str,
    _java_path: &str,
    wrapper_path: &str,
    max_memory: &str,
    version_name: &str,
    player_name: &str,
    auth_token: &str,
    uuid: &str,
    authlib_injector_path: &str,
    yggdrasil_api: &str,
    prefetched_data: &str,
    loadType: &str,
    loadName: &str,
    window_width: &str,
    window_height: &str
) -> anyhow::Result<String> {
    let minecraft_path_buf = PathBuf::from(minecraft_path);

    // 如果 uuid 为空或不合法，根据玩家名生成离线 UUID
    let uuid = if uuid.is_empty() || !is_valid_uuid(uuid) {
        let generated = offline_uuid(player_name);
        println!("[启动器] UUID 无效 (\"{}\"), 已根据玩家名生成: {}", uuid, generated);
        generated
    } else {
        uuid.to_string()
    };
    let uuid = uuid.as_str();

    let version_path = minecraft_path_buf
        .join("versions")
        .join(version_name)
        .join(format!("{}.json", version_name));

    let mut load_library_paths: Vec<String> = Vec::new();
    let mut load_jvm_params: Vec<String> = Vec::new();
    let mut load_game_params: Vec<String> = Vec::new();
    let mut load_main_class: Option<String> = None;

    let normalize = |p: &PathBuf| p.to_string_lossy().replace('\\', "/");

    if loadType != "0" {
        let load_path = minecraft_path_buf
            .join("versions")
            .join(loadName);
        println!("正在加载版本信息，loadType: {}, loadName: {}, loadPath: {}", loadType, loadName, load_path.display());
        if loadType == "1" {
            println!("loadType为1，检查load_path是否为目录");
            if load_path.is_dir() {
                println!("load_path是目录，开始读取JSON文件");
                let entries: Vec<_> = std::fs::read_dir(&load_path).context("Failed to read load_path dir")?.collect();
                println!("目录中共有 {} 个文件/文件夹", entries.len());
                for entry in entries {
                    let entry = entry.context("Failed to read dir entry")?;
                    let path = entry.path();
                    println!("检查文件: {}", path.display());
                    println!("  文件扩展名: {:?}", path.extension());
                    if path.extension()
                        .and_then(|s| s.to_str())
                        .map(|s| s.eq_ignore_ascii_case("json"))
                        .unwrap_or(false)
                    {
                        println!("找到JSON文件: {}", path.display());
                        let content = std::fs::read_to_string(&path)
                            .with_context(|| format!("Failed to read {}", path.display()))?;
                        println!("JSON内容: {}", content);

                        let value: serde_json::Value = serde_json::from_reader(
                            std::fs::File::open(&path)
                                .with_context(|| format!("Failed to open {}", path.display()))?
                        )?;

                        println!("解析后的JSON值: {}", serde_json::to_string_pretty(&value).unwrap_or_else(|_| "无法序列化JSON".to_string()));

                        let root: &serde_json::Value = if let Some(vinfo) = value.get("versionInfo") {
                            println!("使用versionInfo字段作为根对象");
                            vinfo
                        } else {
                            println!("使用整个JSON作为根对象");
                            &value
                        };

                        println!("开始提取mainClass和参数");
                        println!("JSON根对象的所有键: {:?}", root.as_object().map(|o| o.keys().collect::<Vec<_>>()));
                        if let Some(main_class) = root.get("mainClass").and_then(|v| v.as_str()) {
                            println!("找到mainClass: {}", main_class);
                            load_main_class = Some(main_class.to_string());
                            println!("load_main_class已设置: {:?}", load_main_class);
                        } else {
                            println!("未找到mainClass字段");
                        }

                        // 修复点1: 不再合并参数，保持独立元素
                        println!("检查minecraftArguments字段...");
                        if let Some(mca) = root.get("minecraftArguments").and_then(|v| v.as_str()) {
                            println!("找到minecraftArguments: {}", mca);
                            for token in mca.split_whitespace() {
                                load_game_params.push(token.trim().to_string());
                            }
                            println!("load_game_params已添加: {:?}", load_game_params);
                        } else {
                            println!("未找到minecraftArguments字段，检查arguments字段...");
                            if let Some(args_obj) = root.get("arguments") {
                                println!("找到arguments对象");
                                println!("arguments对象的所有键: {:?}", args_obj.as_object().map(|o| o.keys().collect::<Vec<_>>()));
                                let mut game_vals = Vec::new();
                                let mut jvm_vals = Vec::new();

                                if let Some(game_arr) = args_obj.get("game").and_then(|v| v.as_array()) {
                                    println!("处理arguments.game数组，长度: {}", game_arr.len());
                                    for el in game_arr {
                                        if let Some(s) = el.as_str() {
                                            let trimmed = s.trim();
                                            game_vals.push(trimmed.to_string());
                                            load_game_params.push(trimmed.to_string());
                                        }
                                    }
                                    println!("load_game_params已添加: {:?}", load_game_params);
                                } else {
                                    println!("未找到arguments.game数组");
                                }

                                if let Some(jvm_arr) = args_obj.get("jvm").and_then(|v| v.as_array()) {
                                    println!("处理arguments.jvm数组，长度: {}", jvm_arr.len());
                                    println!("arguments.jvm数组的前5个元素: {:?}", jvm_arr.iter().take(5).collect::<Vec<_>>());
                                    let mut i = 0;
                                    while i < jvm_arr.len() {
                                    println!("处理jvm数组第{}个元素: {:?}", i, jvm_arr[i]);
                                    if let Some(s) = jvm_arr[i].as_str() {
                                        let trimmed = s.trim();
                                        println!("  提取到字符串: {}", trimmed);

                                        // 检查是否是"-p"参数
                                        if trimmed == "-p" && i + 1 < jvm_arr.len() {
                                            // 获取"-p"参数后的值
                                            if let Some(p_value) = jvm_arr[i + 1].as_str() {
                                                println!("  检测到-p参数，值为: {}", p_value);
                                                let library_dir = minecraft_path_buf.join("libraries");
                                                let library_dir_str = normalize(&library_dir);

                                                // 替换占位符
                                                let replaced = p_value
                                                    .replace("${classpath_separator}", ";")
                                                    .replace("${library_directory}", &library_dir_str)
                                                    .replace("neoforge-,${version_name}.jar", &loadName);

                                                jvm_vals.push(trimmed.to_string());
                                                jvm_vals.push(replaced.clone());
                                                load_jvm_params.push(trimmed.to_string());
                                                load_jvm_params.push(replaced);

                                                // 跳过下一个元素，因为我们已经处理了
                                                i += 2;
                                                continue;
                                            }
                                        }

                                        // 检查是否是带值的参数（如-Dkey=value或--key=value）
                                        let param_with_value = if trimmed.contains('=') {
                                            // 对于带等号的参数，替换${library_directory}占位符
                                            let library_dir = minecraft_path_buf.join("libraries");
                                            let library_dir_str = normalize(&library_dir);
                                            let mut replaced = trimmed.replace("${library_directory}", &library_dir_str);

                                            // 特判：当检测到特定的-DignoreList参数时，替换其中的"neoforge-,${version_name}"为loadName
                                            if trimmed.starts_with("-DignoreList=securejarhandler,asm,asm-commons,asm-tree,asm-util,asm-analysis,bootstraplauncher,JarJarFileSystems,events-1.0.2.jar,core-1.0.2.jar,language-java,language-lowcode,language-minecraft,client-extra,neoforge-,${version_name}.jar") {
                                                replaced = replaced.replace("neoforge-,${version_name}", &loadName);
                                            } else {
                                                // 其他情况，替换neoforge-,${version_name}.jar为loadName
                                                replaced = replaced.replace("neoforge-,${version_name}.jar", &loadName);
                                            }
                                            replaced
                                        } else {
                                            trimmed.to_string()
                                        };

                                        println!("  最终参数值: {}", param_with_value);
                                        jvm_vals.push(param_with_value.clone());
                                        load_jvm_params.push(param_with_value);
                                    }
                                    i += 1;
                                }
                            }

                            println!("arguments.game: {:?}", game_vals);
                            println!("arguments.jvm: {:?}", jvm_vals);
                            println!("load_jvm_params最终值: {:?}", load_jvm_params);
                            } else {
                                println!("未找到arguments字段");
                            }
                        }

                        // 检查是否是LiteLoader
                        println!("JSON参数处理完成:");
                        println!("  load_main_class: {:?}", load_main_class);
                        println!("  load_game_params: {:?}", load_game_params);
                        println!("  load_jvm_params: {:?}", load_jvm_params);

                        // 检查是否是LiteLoader
                        let is_liteloader = load_main_class.as_ref().map_or(false, |s| s.contains("LiteLoader"));
                        println!("是否是LiteLoader: {}", is_liteloader);

                        // 处理versionPatch.json（如果有）
                        let mut patch_library_paths: Vec<String> = Vec::new();
                        if is_liteloader {
                            let patch_json_path = load_path.join("versionPatch.json");
                            if patch_json_path.exists() {
                                println!("找到versionPatch.json，开始处理");
                                let patch_content = std::fs::read_to_string(&patch_json_path)
                                    .with_context(|| format!("Failed to read {}", patch_json_path.display()))?;
                                let patch_value: serde_json::Value = serde_json::from_str(&patch_content)
                                    .with_context(|| format!("Failed to parse {}", patch_json_path.display()))?;

                                if let Some(patch_libraries) = patch_value.get("libraries").and_then(|v| v.as_array()) {
                                    for patch_lib in patch_libraries {
                                        if let Some(downloads) = patch_lib.get("downloads") {
                                            if let Some(artifact) = downloads.get("artifact") {
                                                if let Some(path_str) = artifact.get("path").and_then(|p| p.as_str()) {
                                                    let abs = minecraft_path_buf.join("libraries").join(path_str);
                                                    let norm = normalize(&abs);
                                                    patch_library_paths.push(norm);
                                                }
                                            }
                                            if let Some(classifiers) = downloads.get("classifiers").and_then(|v| v.as_object()) {
                                                for art in classifiers.values() {
                                                    if let Some(path_str) = art.get("path").and_then(|p| p.as_str()) {
                                                        let abs = minecraft_path_buf.join("libraries").join(path_str);
                                                        let norm = normalize(&abs);
                                                        patch_library_paths.push(norm);
                                                    }
                                                }
                                            }
                                        } else if let Some(name_val) = patch_lib.get("name").and_then(|n| n.as_str()) {
                                            // 对于没有downloads字段但有name字段的库
                                            if let Some(lib_path) = library_name_to_path(name_val) {
                                                let abs = minecraft_path_buf.join("libraries").join(&lib_path);
                                                let norm = normalize(&abs);
                                                patch_library_paths.push(norm);
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        if let Some(libraries) = root.get("libraries").and_then(|v| v.as_array()) {
                            for lib in libraries {
                                if let Some(downloads) = lib.get("downloads") {
                                    if let Some(artifact) = downloads.get("artifact") {
                                        if let Some(path_str) = artifact.get("path").and_then(|p| p.as_str()) {
                                            let abs = minecraft_path_buf.join("libraries").join(path_str);
                                            let norm = normalize(&abs);
                                            println!("library artifact path: {}", abs.display());
                                            load_library_paths.push(norm.clone());

                                            if let Some(name) = lib.get("name").and_then(|n| n.as_str()) {
                                                if name.starts_with("net.minecraftforge:forge") {
                                                    if let Some(folder) = abs.parent() {
                                                        if folder.is_dir() {
                                                            for jf in std::fs::read_dir(folder)? {
                                                                let jf = jf?;
                                                                let jfpath = jf.path();
                                                                if jfpath.extension().and_then(|s| s.to_str()) == Some("jar") {
                                                                    println!("forge jar: {}", jfpath.display());
                                                                    load_library_paths.push(normalize(&jfpath));
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    if let Some(classifiers) = downloads.get("classifiers").and_then(|v| v.as_object()) {
                                        for art in classifiers.values() {
                                            if let Some(path_str) = art.get("path").and_then(|p| p.as_str()) {
                                                let abs = minecraft_path_buf.join("libraries").join(path_str);
                                                let norm = normalize(&abs);
                                                println!("library classifier path: {}", abs.display());
                                                load_library_paths.push(norm);
                                            }
                                        }
                                    }
                                } else {
                                    // 对于所有有name字段的库，都根据name构建路径并添加到classpath
                                    // 这确保了像LiteLoader这样的mod加载器的所有依赖库都被正确加载
                                    // 无论是否有downloads、url或serverreq字段
                                    if let Some(name_val) = lib.get("name").and_then(|n| n.as_str()) {
                                        if let Some(lib_path) = library_name_to_path(name_val) {
                                            let abs = minecraft_path_buf.join("libraries").join(&lib_path);
                                            let norm = normalize(&abs);
                                            println!("library artifact path (from name): {}", abs.display());
                                            // 检查是否已经添加过，避免重复
                                            if !load_library_paths.contains(&norm) {
                                                load_library_paths.push(norm);
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // 如果是LiteLoader，比较load_library_paths和patch_library_paths
                        // 如果patch中的库版本更高，则替换load中的库
                        if is_liteloader && !patch_library_paths.is_empty() {
                            println!("正在比较LiteLoader和versionPatch.json中的库版本...");

                            // 存储需要移除的load库的索引
                            let mut indices_to_remove: Vec<usize> = Vec::new();

                            // 存储需要添加的patch库
                            let mut patches_to_add: Vec<String> = Vec::new();

                            // 遍历load_library_paths，查找是否有更高版本的patch库
                            for (i, load_path) in load_library_paths.iter().enumerate() {
                                if let Some((load_group, load_artifact, load_version)) = parse_library_path(load_path) {
                                    // 在patch_library_paths中查找相同group和artifact的库
                                    for patch_path in &patch_library_paths {
                                        if let Some((patch_group, patch_artifact, patch_version)) = parse_library_path(patch_path) {
                                            // 如果group和artifact相同，比较版本号
                                            if load_group == patch_group && load_artifact == patch_artifact {
                                                // 如果patch库的版本更高，标记load库为需要移除
                                                if compare_versions(&patch_version, &load_version) {
                                                    indices_to_remove.push(i);
                                                    patches_to_add.push(patch_path.clone());
                                                    println!("替换库: {} (load版本: {}) -> {} (patch版本: {})",
                                                        load_path, load_version, patch_path, patch_version);
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // 移除需要替换的load库（从后往前移，避免索引变化）
                            indices_to_remove.sort();
                            indices_to_remove.dedup();
                            for i in indices_to_remove.into_iter().rev() {
                                load_library_paths.remove(i);
                            }

                            // 添加patch库
                            for patch_path in patches_to_add {
                                if !load_library_paths.contains(&patch_path) {
                                    load_library_paths.push(patch_path);
                                }
                            }
                        }
                    }
                }
            } else {
                println!("load_path不是目录: {}", load_path.display());
            }
        } else {
            if load_path.is_dir() {
                for entry in std::fs::read_dir(&load_path).context("Failed to read load_path dir")? {
                    let entry = entry.context("Failed to read dir entry")?;
                    let path = entry.path();
                    if path.extension()
                        .and_then(|s| s.to_str())
                        .map(|s| s.eq_ignore_ascii_case("json"))
                        .unwrap_or(false)
                    {
                        let content = std::fs::read_to_string(&path)
                            .with_context(|| format!("Failed to read file {}", path.display()))?;
                        println!("Content of {}:\n{}", path.display(), content);
                        
                        // 解析 JSON 并提取库信息
                        let value: serde_json::Value = serde_json::from_str(&content)
                            .with_context(|| format!("Failed to parse {}", path.display()))?;
                        
                        let root: &serde_json::Value = if let Some(vinfo) = value.get("versionInfo") {
                            vinfo
                        } else {
                            &value
                        };
                        
                        // 提取库信息
                        if let Some(libraries) = root.get("libraries").and_then(|v| v.as_array()) {
                            for lib in libraries {
                                if let Some(downloads) = lib.get("downloads") {
                                    if let Some(artifact) = downloads.get("artifact") {
                                        if let Some(path_str) = artifact.get("path").and_then(|p| p.as_str()) {
                                            let abs = minecraft_path_buf.join("libraries").join(path_str);
                                            let norm = normalize(&abs);
                                            load_library_paths.push(norm);
                                        }
                                    }
                                    if let Some(classifiers) = downloads.get("classifiers").and_then(|v| v.as_object()) {
                                        for art in classifiers.values() {
                                            if let Some(path_str) = art.get("path").and_then(|p| p.as_str()) {
                                                let abs = minecraft_path_buf.join("libraries").join(path_str);
                                                let norm = normalize(&abs);
                                                load_library_paths.push(norm);
                                            }
                                        }
                                    }
                                } else if let Some(name_val) = lib.get("name").and_then(|n| n.as_str()) {
                                    if let Some(lib_path) = library_name_to_path(name_val) {
                                        let abs = minecraft_path_buf.join("libraries").join(&lib_path);
                                        let norm = normalize(&abs);
                                        if !load_library_paths.contains(&norm) {
                                            load_library_paths.push(norm);
                                        }
                                    }
                                }
                            }
                        }
                        
                        // 提取参数信息
                        if let Some(args_obj) = root.get("arguments") {
                            if let Some(game_arr) = args_obj.get("game").and_then(|v| v.as_array()) {
                                for el in game_arr {
                                    if let Some(s) = el.as_str() {
                                        load_game_params.push(s.trim().to_string());
                                    }
                                }
                            }
                            if let Some(jvm_arr) = args_obj.get("jvm").and_then(|v| v.as_array()) {
                                for el in jvm_arr {
                                    if let Some(s) = el.as_str() {
                                        load_jvm_params.push(s.trim().to_string());
                                    }
                                }
                            }
                        }
                        
                        // 提取minecraftArguments
                        if let Some(mca) = root.get("minecraftArguments").and_then(|v| v.as_str()) {
                            for token in mca.split_whitespace() {
                                load_game_params.push(token.trim().to_string());
                            }
                        }
                        
                        // 提取mainClass
                        if let Some(main_class) = root.get("mainClass").and_then(|v| v.as_str()) {
                            load_main_class = Some(main_class.to_string());
                        }
                    }
                }
            } else {
                println!("load_path is not a directory: {}", load_path.display());
            }
        }
    }

    let mut version_json: VersionJson = serde_json::from_reader(
        std::fs::File::open(version_path).context("Failed to open version json")?
    ).context("Failed to parse version json")?;

    let parent_version: Option<String> = version_json.parent_version.clone();

    if let Some(parent) = &version_json.parent_version {
        let parent_path = minecraft_path_buf
            .join("versions")
            .join(parent)
            .join(format!("{}.json", parent));

        let parent_json: VersionJson = serde_json::from_reader(
            std::fs::File::open(parent_path).context("Failed to open parent json")?
        )?;

        if version_json.asset_index.is_none() {
            version_json.asset_index = parent_json.asset_index;
        }

        // 继承 parent 的 logging（日志 XML 文件通常在父版本目录下）
        if version_json.logging.is_none() {
            version_json.logging = parent_json.logging;
        }

        // 合并 parent 的 libraries（当前版本的库优先，避免重复）
        // 使用 (group, artifact) 作为 key 来去重
        use std::collections::HashSet;
        let mut seen: HashSet<(String, String)> = HashSet::new();
        for lib in &version_json.libraries {
            let parts: Vec<&str> = lib.name.split(':').collect();
            if parts.len() >= 2 {
                seen.insert((parts[0].to_string(), parts[1].to_string()));
            }
        }
        for parent_lib in parent_json.libraries {
            let parts: Vec<&str> = parent_lib.name.split(':').collect();
            if parts.len() >= 2 {
                let key = (parts[0].to_string(), parts[1].to_string());
                if !seen.contains(&key) {
                    version_json.libraries.push(parent_lib);
                    seen.insert(key);
                }
            }
        }
    }

    if loadType != "0" && load_main_class.is_some() {
        version_json.main_class = load_main_class.unwrap();
    }

    let os_info = os_info::get();
    let is_windows = os_info.os_type() == Type::Windows;
    let is_macos = os_info.os_type() == Type::Macos;
    let _is_linux = os_info.os_type() == Type::Linux;

    fn check_rules(rules: &[Rule], os_info: &os_info::Info) -> bool {
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

                let version_match = if let Some(version_pattern) = &os_rule.version {
                    let re = Regex::new(version_pattern).unwrap();
                    re.is_match(&os_info.version().to_string())
                } else {
                    true
                };

                rule_matched = os_match && version_match;
            }

            match rule.action.as_str() {
                "allow" => allowed = rule_matched,
                "disallow" => allowed = !rule_matched,
                _ => ()
            }
        }
        allowed
    }

    let format_path = |p: PathBuf| -> String {
        p.to_string_lossy().replace('\\', "/")
    };

    // 处理可能为空的认证字段
    let effective_token = if auth_token.trim().is_empty() {
        "0"
    } else {
        auth_token
    };

    // 生成 UUID v3 (基于名称) 从玩家名
    fn generate_uuid_from_name(name: &str) -> String {
        // 使用简单的 FNV 1a 哈希 + 常量填充生成 UUID v3
        let mut hash: [u8; 16] = [0u8; 16];
        let mut state: u64 = 14695981039346656037u64; // FNV-1a offset basis
        for b in name.as_bytes() {
            state ^= *b as u64;
            state = state.wrapping_mul(1099511628211); // FNV prime
        }
        // 把 64-bit state 散布到 16 字节
        let mut s = state;
        for i in 0..8 {
            hash[i] = (s & 0xff) as u8;
            s >>= 8;
        }
        // 用另一个哈希填充后 8 字节
        state = state.wrapping_mul(1099511628211);
        state ^= name.len() as u64;
        for i in 8..16 {
            hash[i] = (state & 0xff) as u8;
            state >>= 8;
        }
        // 设置版本 3 (基于名称)
        hash[6] = (hash[6] & 0x0f) | 0x30;
        // 设置 RFC 4122 变体
        hash[8] = (hash[8] & 0x3f) | 0x80;
        format!("{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
            u32::from_be_bytes([hash[0], hash[1], hash[2], hash[3]]),
            u16::from_be_bytes([hash[4], hash[5]]),
            u16::from_be_bytes([hash[6], hash[7]]),
            u16::from_be_bytes([hash[8], hash[9]]),
            u64::from_be_bytes([hash[10], hash[11], hash[12], hash[13], hash[14], hash[15], 0, 0]) >> 16
        )
    }

    let effective_uuid = if uuid.trim().is_empty() {
        generate_uuid_from_name(player_name)
    } else {
        uuid.to_string()
    };

    let replace_placeholders = |s: &str| -> String {
        let result = s.replace("${auth_player_name}", player_name)
         .replace("${auth_session}", &effective_token)
         .replace("${auth_access_token}", &effective_token)
         .replace("${auth_uuid}", &effective_uuid)
         .replace("${user_properties}", r#"{"issuer":["Mojang"]}"#)
         .replace("${version_name}", version_name)
         .replace("${natives_directory}", &format_path(
             minecraft_path_buf
                 .join("versions")
                 .join(version_name)
                 .join(format!("{}-natives", version_name))
         ))
         .replace("${game_directory}", &format_path(
             minecraft_path_buf
                 .join("versions")
                 .join(if loadType != "0" && !loadName.is_empty() { loadName } else { version_name })
         ))
         .replace("${assets_root}", &format_path(
             minecraft_path_buf.join("assets")
         ))
         .replace("${assets_index_name}",
             &version_json.asset_index.as_ref().map(|a| a.id.trim()).unwrap_or(&String::new()))
         .replace("${user_type}", "msa")
         .replace("${version_type}", "RTL");

        // 将剩余的${}格式参数转换为{}格式
        let re = Regex::new(r"\$\{[^}]+\}").unwrap();
        re.replace_all(&result, "{}").to_string()
    };

    let mut class_path_entries: Vec<String> = version_json.libraries
        .iter()
        .filter_map(|lib| {
            // 检查规则或serverreq标志
            let allowed = check_rules(&lib.rules, &os_info) || lib.serverreq;
            if !allowed {
                return None;
            }
            let artifact_path = if !lib.downloads.classifiers.is_empty() {
                let classifier = lib.natives.get(match os_info.os_type() {
                    Type::Windows => "windows",
                    Type::Macos => "osx",
                    Type::Linux => "linux",
                    _ => return None,
                }).and_then(|s| s.strip_prefix("natives-"));
                lib.downloads.classifiers.get(classifier?)
                    .map(|a| minecraft_path_buf.join("libraries").join(&a.path))
            } else if lib.downloads.artifact.is_some() {
                lib.downloads.artifact.as_ref()
                    .map(|a| minecraft_path_buf.join("libraries").join(&a.path))
            } else {
                // 没有 downloads 信息：根据 name 构建路径
                // 兼容低版本 Forge / 旧格式 JSON，它们的库没有 downloads 字段
                if let Some(path) = library_name_to_path(&lib.name) {
                    Some(minecraft_path_buf.join("libraries").join(path))
                } else {
                    None
                }
            };

            // 对于 -SNAPSHOT 版本，实际 jar 文件名可能带 timestamp/buildNumber
            // 例如: mixin-0.7.4-SNAPSHOT.jar -> mixin-0.7.4-20171010.121826-8.jar
            // 无论是否有 downloads 信息，都需要做这个检查
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

            resolved_path.map(|p| format_path(p))
        })
        .collect();

    // 验证 classpath 中每个文件是否存在（启动前检查，避免"找不到主类"）
    {
        let mut missing: Vec<String> = Vec::new();
        for entry in &class_path_entries {
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

    // 处理load_library_paths，实现库版本替换的逻辑
    if !load_library_paths.is_empty() {
        // 存储需要移除的原版库的索引
        let mut indices_to_remove: Vec<usize> = Vec::new();

        // 存储已处理的load库的标识信息
        let mut processed_load_libs: Vec<(String, String, String)> = Vec::new();

        // 首先检查load_library_paths中的库
        for load_path in &load_library_paths {
            // 解析load库的路径
            if let Some((load_group, load_artifact, load_version)) = parse_library_path(load_path) {
                // 检查是否已经处理过相同group和artifact的库
                let already_processed = processed_load_libs.iter().any(|(g, a, _)| {
                    g == &load_group && a == &load_artifact
                });

                if !already_processed {
                    // 标记为已处理
                    processed_load_libs.push((load_group.clone(), load_artifact.clone(), load_version.clone()));

                    // 检查原版库中是否有相同group和artifact的库
                    for (i, vanilla_path) in class_path_entries.iter().enumerate() {
                        if let Some((vanilla_group, vanilla_artifact, vanilla_version)) = parse_library_path(vanilla_path) {
                            // 如果group和artifact相同，比较版本号
                            if vanilla_group == load_group && vanilla_artifact == load_artifact {
                                // 如果load库的版本更高，标记原版库为需要移除
                                if compare_versions(&load_version, &vanilla_version) {
                                    indices_to_remove.push(i);
                                    println!("替换库: {} (原版版本: {}) -> {} (load版本: {})",
                                        vanilla_path, vanilla_version, load_path, load_version);
                                }
                            }
                        }
                    }
                }
            }
        }

        // 移除需要替换的原版库（从后往前移，避免索引变化）
        indices_to_remove.sort();
        indices_to_remove.dedup();
        for i in indices_to_remove.into_iter().rev() {
            class_path_entries.remove(i);
        }

        // 添加load_library_paths中的库
        for p in &load_library_paths {
            if !class_path_entries.contains(p) {
                class_path_entries.push(p.clone());
            }
        }
    }

    // 对于使用 Java Module System 的启动方式（Forge 1.17+ / NeoForge），
    // fmlloader 会从 libraryDirectory 自己查找 minecraft client jar
    // 不再需要把原版 minecraft jar 加入 classpath，否则会被 Module System 识别为
    // automatic module 与 minecraft 模块冲突（"Modules minecraft and _1._18._2 export package ..."）。
    //
    // 判断依据：
    // 1. libraries 中包含 fmlloader 或 bootstraplauncher（对于 Forge 版本名直接启动的情况）
    // 2. 主类中包含 bootstraplauncher / modlauncher / neo / fml / ModLauncher（
    //    对于通过 loadType/loadName 机制加载 Forge 配置但 version_name 是原版版本名的情况）
    let main_class_lc = version_json.main_class.to_lowercase();
    let uses_module_system = version_json.libraries.iter().any(|lib| {
        lib.name.contains(":fmlloader:") || lib.name.contains(":bootstraplauncher:")
    }) || main_class_lc.contains("bootstraplauncher")
        || main_class_lc.contains("modlauncher")
        || main_class_lc.contains("cpw.mods")
        || main_class_lc.contains("fml");

    if !uses_module_system {
        let vanilla_jar = format_path(
            minecraft_path_buf
                .join("versions")
                .join(version_name)
                .join(format!("{}.jar", version_name))
        );
        class_path_entries.push(vanilla_jar);
    }

    let mut args: Vec<String> = vec![
        "-Xmn768m".to_string(),
        format!("-Xmx{}m", max_memory),
    ];

    let extra_before_cp: Vec<String> = if !load_jvm_params.is_empty() {
        println!("load_jvm_params不为空，创建extra_before_cp");
        load_jvm_params.iter().map(|p| clean_param_spaces(p)).collect()
    } else {
        println!("load_jvm_params为空，extra_before_cp为空");
        Vec::new()
    };

    let extra_after_cp: Vec<String> = load_game_params;

    if is_macos {
        args.push("-XstartOnFirstThread".to_string());
    }

    if os_info.architecture().map_or(false, |a| a.contains("x86")) {
        args.push("-Xss1M".to_string());
    }

    if is_windows {
        args.push("-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump".to_string());
    }

    args.extend(vec![
        "-XX:+UseG1GC".to_string(),
        "-XX:-UseAdaptiveSizePolicy".to_string(),
        "-XX:-OmitStackTraceInFastThrow".to_string(),
        "-Djdk.lang.Process.allowAmbiguousCommands=true".to_string(),
        "-Dfml.ignoreInvalidMinecraftCertificates=True".to_string(),
        "-Dfml.ignorePatchDiscrepancies=True".to_string(),
    ]);

    if let Some(logging) = &version_json.logging {
        if let Some(client) = &logging.client {
            // 先在当前版本目录找日志文件，找不到则尝试父版本目录
            let mut log_file_path = minecraft_path_buf
                .join("versions")
                .join(version_name)
                .join(&client.file.id);
            if !log_file_path.exists() {
                if let Some(pv) = &parent_version {
                    let parent_file = minecraft_path_buf
                        .join("versions")
                        .join(pv)
                        .join(&client.file.id);
                    if parent_file.exists() {
                        log_file_path = parent_file;
                    }
                }
            }
            let log_path = format_path(log_file_path);
            // Windows 上 Java 的 URI.toURL() 需要 file:/// 协议前缀
            // 否则会把盘符 D: 误认为 URL scheme
            if cfg!(windows) {
                args.push(format!("-Dlog4j.configurationFile=file:///{}", log_path));
            } else {
                args.push(format!("-Dlog4j.configurationFile=file:{}", log_path));
            }
        }
    }

    let fixed_params = vec![
        // 新版 macOS 的 os.name 返回 "Mac OS" 而非 "Mac OS X"，旧版 LWJGL 不识别
        // 强制设为 "Mac OS X" 以确保 LWJGL 正确识别平台
        if OS == "macos" {
            "-Dos.name=Mac OS X".to_string()
        } else {
            format!("-Dos.name={}", os_info.os_type())
        },
        format!("-Dos.version={}", os_info.version()),
        format!("-DlibraryDirectory={}", format_path(minecraft_path_buf.join("libraries"))),
    ];

    // 确保 -Djava.library.path 参数总是被添加
    // 根据loadType和loadName来决定使用哪个版本名
    // 只在neoforge时使用loadName，其他modloader使用version_name
    let is_neoforge = loadType != "0" && !loadName.is_empty() && loadName.to_lowercase().contains("neoforge");
    // 对于loadType为1的情况，如果是neoforge，使用loadName；否则使用version_name
    let native_version = if loadType == "1" && is_neoforge {
        &loadName
    } else {
        version_name
    };
    let native_path = format_path(
        minecraft_path_buf
            .join("versions")
            .join(version_name)
            .join(format!("{}-natives", native_version))
    );
    args.push(format!("-Djava.library.path={}", native_path));

    // 添加neoforge需要的额外系统属性
    if is_neoforge {
        args.push(format!("-Djna.tmpdir={}", native_path));
        args.push(format!("-Dorg.lwjgl.system.SharedLibraryExtractPath={}", native_path));
        args.push(format!("-Dio.netty.native.workdir={}", native_path));
    }

    let existing_params: HashSet<String> = version_json.arguments
        .iter()
        .flat_map(|a| a.jvm.iter().flatten())
        .filter_map(|arg| match arg {
            JvmArgument::String(s) => Some(s.split('=').next().unwrap().to_string()),
            _ => None,
        })
        .collect();

    for param in fixed_params {
        let key = param.split('=').next().unwrap();
        if !existing_params.contains(key) {
            args.push(param);
        }
    }

    if !authlib_injector_path.is_empty() && !yggdrasil_api.is_empty() {
        args.push(format!("-javaagent:{}={}", authlib_injector_path, yggdrasil_api));
    }

    if !prefetched_data.is_empty() {
        args.push(format!("-Dauthlibinjector.yggdrasil.prefetched={}", prefetched_data));
    }

    // 先处理extra_before_cp中的参数，确保所有以-开头的参数在-cp之前
    // 不进行去重检查，确保load中jvm和game里面的所有参数都被加入总启动参数中
    println!("处理extra_before_cp，长度: {}", extra_before_cp.len());
    {
        let mut ei = 0;
        while ei < extra_before_cp.len() {
            let p = &extra_before_cp[ei];
            let has_value = p.starts_with('-')
                && ei + 1 < extra_before_cp.len()
                && !extra_before_cp[ei + 1].starts_with('-');

            // 直接添加参数，不进行去重检查
            args.push(p.clone());
            if has_value {
                args.push(extra_before_cp[ei + 1].clone());
                ei += 2;
            } else {
                ei += 1;
            }
        }
    }

    // 将 Wrapper JAR 也加入 classpath（不能用 -jar，否则 Java 会忽略 -cp）

    let sep = if is_windows { ";" } else { ":" };
    let class_path = class_path_entries.join(sep);
    args.push("-cp".to_string());
    args.push(class_path);

    if !wrapper_path.is_empty() {
        let wrapper_abs = format_path(PathBuf::from(wrapper_path));
        args.push("-jar".to_string());
        args.push(wrapper_abs);
    }

    let mut game_args_vec: Vec<String> = Vec::new();

    // 处理原版游戏参数
    if let Some(game_args) = version_json.arguments.as_ref().and_then(|a| a.game.as_ref()) {
        for arg in game_args {
            match arg {
                serde_json::Value::String(s) => {
                    let replaced = replace_placeholders(s);
                    if !replaced.trim().is_empty() {
                        game_args_vec.push(replaced.trim().to_string());
                    }
                }
                serde_json::Value::Array(arr) => {
                    for item in arr {
                        if let Some(s) = item.as_str() {
                            let replaced = replace_placeholders(s);
                            if !replaced.trim().is_empty() {
                                game_args_vec.push(replaced.trim().to_string());
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    } else if let Some(minecraft_args) = &version_json.minecraft_arguments {
        for arg in minecraft_args.split_whitespace() {
            let replaced = replace_placeholders(arg);
            if !replaced.trim().is_empty() {
                game_args_vec.push(replaced.trim().to_string());
            }
        }
    }

    game_args_vec.extend(vec![
        "--width".to_string(),
        (if window_width.is_empty() { "873" } else { window_width }).to_string(),
        "--height".to_string(),
        (if window_height.is_empty() { "486" } else { window_height }).to_string(),
    ]);

    // 修复点2: 不进行去重检查，确保load中game里面的所有参数都被加入总启动参数中
    {
        let mut li = 0;
        while li < extra_after_cp.len() {
            let tok = &extra_after_cp[li];

            // 检查是否是占位符参数（如 ${auth_player_name}）
            let is_placeholder = tok.starts_with("${") && tok.ends_with("}");

            // 只过滤占位符参数，其他参数都保留
            if is_placeholder {
                li += 1;
                continue;
            }
            if !(game_args_vec.contains(tok)&&tok.starts_with("--")) {
            game_args_vec.push(tok.clone());
            }
            li += 1;
        }
    }

    // 修复点3: 改进参数转发逻辑
    let mut forwarded_args: Vec<String> = Vec::new();
    let mut filtered_game_args: Vec<String> = Vec::new();
    let mut i = 0;

    while i < game_args_vec.len() {
        let arg = &game_args_vec[i];

        // 特殊处理 --tweakClass 参数
        if arg == "--tweakClass" && i + 1 < game_args_vec.len() {
            forwarded_args.push(arg.clone());
            forwarded_args.push(game_args_vec[i + 1].clone());
            i += 1; // 跳过值
        }
        // 特判：当原版参数中包含--assetsDir时，后面的值一定为minecraft文件夹路径/assets
        else if arg == "--assetsDir" && i + 1 < game_args_vec.len() {
            let assets_path = format_path(minecraft_path_buf.join("assets"));
            forwarded_args.push(arg.clone());
            forwarded_args.push(assets_path);
            i += 1; // 跳过原值
        }
        // 处理其他 -- 参数
        else if arg.starts_with("--") {
            forwarded_args.push(arg.clone());
            if i + 1 < game_args_vec.len() && !game_args_vec[i + 1].starts_with("--") {
                forwarded_args.push(game_args_vec[i + 1].clone());
                i += 1;
            }
        }
        // 处理非 -- 参数
        else {
            filtered_game_args.push(arg.clone());
        }
        i += 1;
    }

    // game args = forwarded_args + filtered_game_args
    let mut game_app_args: Vec<String> = Vec::new();
    game_app_args.extend(forwarded_args.iter().cloned());
    game_app_args.extend(filtered_game_args.iter().cloned());

    // 处理option.txt文件
    let instance_dir = minecraft_path_buf
        .join("versions")
        .join(version_name);
    let option_file_path = instance_dir.join("options.txt");

    // 检查并创建option.txt文件
    if !option_file_path.exists() {
        if let Some(parent) = option_file_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(&option_file_path, "").ok();
    }

    // 读取并修改option.txt文件
    if let Ok(content) = std::fs::read_to_string(&option_file_path) {
        let mut has_lang = false;
        let mut new_content = String::new();

        for line in content.lines() {
            if line.trim().starts_with("lang:") {
                new_content.push_str(&format!("lang:zh_cn\n"));
                has_lang = true;
            } else {
                new_content.push_str(&format!("{}\n", line));
            }
        }

        if !has_lang {
            new_content.push_str("lang:zh_cn\n");
        }

        std::fs::write(&option_file_path, new_content).ok();
    }

    // 如果有 Wrapper 则用 Wrapper 主类包裹原始主类，否则直接使用原始主类
    if !wrapper_path.is_empty() {
        args.push(version_json.main_class.clone());
    } else {
        args.push(version_json.main_class.clone());
    }
    args.extend(game_app_args);

    // 调试: 分条打印参数，便于排查
    println!("=== 启动参数列表 ({} 项) ===", args.len());
    for (i, a) in args.iter().enumerate() {
        println!("  [{}] {}", i, a);
    }
    println!("=== 参数列表结束 ===");

    let arg = args.join(" ");
    println!("{}", arg);
    Ok(arg)
}

/// 启动游戏（构建参数并执行 Java 进程）
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
    loadType: &str,
    loadName: &str,
    window_width: &str,
    window_height: &str
) -> Result<String, String> {
    // 先构建参数
    let arg_string = build_jvm_arguments_inner(
        app.clone(),
        minecraft_path, java_path, wrapper_path, max_memory, version_name,
        player_name, auth_token, uuid, authlib_injector_path, yggdrasil_api,
        prefetched_data, loadType, loadName, window_width, window_height,
    ).map_err(|e| e.to_string())?;

    // 再启动游戏
    run_command(
        arg_string.split_whitespace().map(|s| s.to_string()).collect(),
        PathBuf::from(java_path),
        PathBuf::from(minecraft_path),
        app,
    ).map_err(|e| e.to_string())?;

    Ok(arg_string)
}