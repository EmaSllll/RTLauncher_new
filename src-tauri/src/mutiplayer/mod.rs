use tauri::command;
use std::path::{PathBuf, Path};
use std::process::{Command, Child, Stdio};
use std::sync::Mutex;
use std::env;
use std::io;
use std::fs;
use std::thread;
use std::io::{BufRead, BufReader};
const OPENP2P_BIN: &str = if cfg!(target_os = "windows") {
    "openp2p.exe"
} else {
    "openp2p"
};
static OPENP2P_PROCESS: Mutex<Option<Child>> = Mutex::new(None);
static LOG_BUFFER: Mutex<Vec<u8>> = Mutex::new(Vec::new());
static RUNAS_MODE: Mutex<bool> = Mutex::new(false);
fn set_runas_mode(on: bool) {
    if let Ok(mut guard) = RUNAS_MODE.lock() {
        *guard = on;
    }
}
fn is_runas_mode() -> bool {
    RUNAS_MODE.lock().map(|g| *g).unwrap_or(false)
}
fn get_bridge_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let home = env::var("HOME")
            .map_err(|_| "无法获取 HOME 环境变量".to_string())?;
        Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("RTLauncher")
            .join("bridge"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let exe_dir = env::current_exe()
            .map_err(|e| format!("无法获取当前可执行文件路径: {}", e))?
            .parent()
            .ok_or_else(|| "无法获取可执行文件父目录".to_string())?
            .to_path_buf();
        Ok(exe_dir.join("RTL").join("bridge"))
    }
}
fn get_openp2p_path() -> Result<PathBuf, String> {
    Ok(get_bridge_dir()?.join(OPENP2P_BIN))
}
fn get_openp2p_dir() -> Result<PathBuf, String> {
    let path = get_openp2p_path()?;
    Ok(path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or(PathBuf::from(".")))
}
fn get_executable_path(path: &Path) -> Result<String, String> {
    if path.is_absolute() {
        Ok(path.display().to_string())
    } else {
        let abs = env::current_dir()
            .map_err(|e| format!("无法获取当前目录: {}", e))?
            .join(path);
        Ok(abs.display().to_string())
    }
}
fn append_log(text: &[u8]) {
    if let Ok(mut guard) = LOG_BUFFER.lock() {
        guard.extend_from_slice(text);
    }
}
fn append_log_str(text: &str) {
    append_log(text.as_bytes());
}
fn openp2p_log_file(working_dir: &Path) -> PathBuf {
    working_dir.join("log").join("openp2p.txt")
}
fn clear_openp2p_log_files(working_dir: &Path) {
    let log_file = openp2p_log_file(working_dir);
    if !log_file.parent().map(|p| p.exists()).unwrap_or(false) {
        if let Err(e) = fs::create_dir_all(log_file.parent().unwrap()) {
            append_log_str(&format!(
                "[RTLauncher] ⚠ 创建日志目录失败: {}\n",
                e
            ));
            return;
        }
    }
    let _ = std::fs::File::create(&log_file);
}
fn start_log_file_tailing(working_dir: PathBuf) {
    use std::sync::Arc;
    let offset = Arc::new(Mutex::new(0u64));
    let log_path = openp2p_log_file(&working_dir);
    thread::spawn(move || {
        loop {
            thread::sleep(std::time::Duration::from_millis(1000));
            if !log_path.exists() {
                continue;
            }
            match fs::metadata(&log_path) {
                Ok(meta) => {
                    let file_size = meta.len();
                    let mut cur_offset = match offset.lock() {
                        Ok(g) => *g,
                        Err(_) => continue,
                    };
                    if file_size < cur_offset {
                        cur_offset = 0;
                        if let Ok(mut g) = offset.lock() {
                            *g = 0;
                        }
                    }
                    if file_size > cur_offset {
                        use std::io::Seek;
                        use std::io::Read;
                        if let Ok(mut file) = std::fs::File::open(&log_path) {
                            if file.seek(std::io::SeekFrom::Start(cur_offset)).is_ok() {
                                let mut reader = file.take(file_size - cur_offset);
                                let mut buffer = Vec::new();
                                if reader.read_to_end(&mut buffer).is_ok() && !buffer.is_empty() {
                                    append_log(&buffer);
                                    if !buffer.ends_with(b"\n") {
                                        append_log_str("\n");
                                    }
                                    if let Ok(mut g) = offset.lock() {
                                        *g = cur_offset + buffer.len() as u64;
                                    }
                                }
                            }
                        }
                    }
                }
                Err(_) => continue,
            }
        }
    });
}
fn start_openp2p_with_args(args: &[&str]) -> Result<String, String> {
    let openp2p_path = get_openp2p_path()?;
    if !openp2p_path.exists() {
        return Err(format!(
            "{} 不存在于: {}，请确保已将 openp2p 可执行文件拖入安装",
            OPENP2P_BIN,
            openp2p_path.display()
        ));
    }
    let working_dir = get_openp2p_dir()?;
    let path_str = get_executable_path(&openp2p_path)?;
    if let Ok(mut guard) = LOG_BUFFER.lock() {
        guard.clear();
    }
    clear_openp2p_log_files(&working_dir);
    append_log_str(&format!(
        "[RTLauncher] 正在启动 openp2p...\n\
         [RTLauncher]   可执行文件: {}\n\
         [RTLauncher]   工作目录: {}\n\
         [RTLauncher]   参数: {:?}\n\
         [RTLauncher]   日志目录: {}/log/\n\n",
        path_str,
        working_dir.display(),
        args,
        working_dir.display()
    ));
    #[cfg(target_os = "windows")]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new(&path_str);
        c.creation_flags(0x08000000); 
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = Command::new(&path_str);
    cmd.current_dir(&working_dir);
    for arg in args {
        cmd.arg(arg);
    }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.stdin(Stdio::null());
    let spawn_result = cmd.spawn();
    match spawn_result {
        Ok(mut child) => {
            if let Some(stdout) = child.stdout.take() {
                thread::spawn(move || {
                    let reader = BufReader::new(stdout);
                    for line in reader.lines() {
                        match line {
                            Ok(text) => {
                                let with_newline = text + "\n";
                                append_log_str(&with_newline);
                            }
                            Err(_) => break,
                        }
                    }
                });
            }
            if let Some(stderr) = child.stderr.take() {
                thread::spawn(move || {
                    let reader = BufReader::new(stderr);
                    for line in reader.lines() {
                        match line {
                            Ok(text) => {
                                let with_newline = "[stderr] ".to_string() + &text + "\n";
                                append_log_str(&with_newline);
                            }
                            Err(_) => break,
                        }
                    }
                });
            }
            start_log_file_tailing(working_dir.clone());
            {
                let mut guard = OPENP2P_PROCESS
                    .lock()
                    .map_err(|_| "无法锁定进程句柄".to_string())?;
                *guard = Some(child);
            }
            append_log_str("[RTLauncher] ✅ openp2p 进程已启动，正在捕获输出...\n");
            append_log_str("[RTLauncher] (右侧日志窗口会持续显示 openp2p 的所有输出)\n\n");
            Ok(path_str)
        }
        Err(e) => {
            let is_elevation_error = cfg!(target_os = "windows")
                && e.raw_os_error() == Some(740);
            if is_elevation_error {
                append_log_str("[RTLauncher] ⚠ openp2p.exe 需要管理员权限才能运行\n");
                append_log_str("[RTLauncher]   正在以管理员身份重新启动（会弹出 UAC 提示）...\n");
                append_log_str("[RTLauncher]   注意：以管理员权限启动后，无法通过管道捕获 stdout\n");
                append_log_str("[RTLauncher]   将改为读取 openp2p 自己生成的日志文件来获取反馈\n\n");
                #[cfg(target_os = "windows")]
                {
                    use winapi::um::shellapi::ShellExecuteW;
                    use winapi::um::winuser::SW_HIDE;
                    use std::os::windows::ffi::OsStrExt;
                    use std::ffi::OsStr;
                    use std::ptr;
                    let exe_path = std::path::PathBuf::from(&path_str);
                    let exe_wide: Vec<u16> = OsStr::new(&exe_path)
                        .encode_wide()
                        .chain(std::iter::once(0))
                        .collect();
                    let args_str = args.join(" ");
                    let args_wide: Vec<u16> = OsStr::new(&args_str)
                        .encode_wide()
                        .chain(std::iter::once(0))
                        .collect();
                    let runas_wide: Vec<u16> = OsStr::new("runas")
                        .encode_wide()
                        .chain(std::iter::once(0))
                        .collect();
                    let work_dir_wide: Vec<u16> = working_dir
                        .as_os_str()
                        .encode_wide()
                        .chain(std::iter::once(0))
                        .collect();
                    let result = unsafe {
                        ShellExecuteW(
                            ptr::null_mut(),
                            runas_wide.as_ptr(),
                            exe_wide.as_ptr(),
                            args_wide.as_ptr(),
                            work_dir_wide.as_ptr(),
                            SW_HIDE,
                        )
                    };
                    if (result as i32) <= 32 {
                        let err = io::Error::last_os_error();
                        let err_msg = format!(
                            "[RTLauncher] ❌ 以管理员身份启动也失败: {}\n\
                             [RTLauncher]   请尝试手动以管理员身份运行此程序（右键 → 以管理员身份运行）\n",
                            err
                        );
                        append_log_str(&err_msg);
                        return Err(err_msg);
                    }
                    start_log_file_tailing(working_dir.clone());
                    append_log_str("[RTLauncher] ✅ openp2p 已以管理员权限启动\n");
                    append_log_str("[RTLauncher]   正在等待 openp2p 生成日志文件...\n");
                    append_log_str("[RTLauncher]   (如果长时间无输出，请检查 openp2p.exe 是否被杀毒软件拦截)\n\n");
                    {
                        let mut guard = OPENP2P_PROCESS
                            .lock()
                            .map_err(|_| "无法锁定进程句柄".to_string())?;
                        *guard = None; 
                    }
                    set_runas_mode(true);
                    Ok(path_str)
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let err_msg = format!(
                        "[RTLauncher] ❌ 启动失败: {}\n\
                         [RTLauncher]   请尝试以 sudo/管理员权限运行此程序\n",
                        e
                    );
                    append_log_str(&err_msg);
                    Err(err_msg)
                }
            } else {
                let err_msg = format!(
                    "[RTLauncher] ❌ 启动失败 (系统错误: {})\n\
                     [RTLauncher]   可执行文件路径: {}\n\
                     [RTLauncher]   工作目录: {}\n\
                     [RTLauncher]   请确认:\n\
                     [RTLauncher]   1. openp2p.exe 存在且路径正确\n\
                     [RTLauncher]   2. 当前用户有权限执行该文件（可能需要以管理员身份运行 RTLauncher）\n\
                     [RTLauncher]   3. 文件没有被杀毒软件拦截\n",
                    e, path_str, working_dir.display()
                );
                append_log_str(&err_msg);
                Err(err_msg)
            }
        }
    }
}
#[command]
pub fn mp_check_openp2p() -> bool {
    get_openp2p_path().map(|p| p.exists()).unwrap_or(false)
}
#[command]
pub fn mp_install_openp2p(src_path: String) -> Result<String, String> {
    let bridge_dir = get_bridge_dir()?;
    std::fs::create_dir_all(&bridge_dir)
        .map_err(|e| format!("创建 bridge 目录失败: {}", e))?;
    let dest = bridge_dir.join(OPENP2P_BIN);
    std::fs::copy(&src_path, &dest)
        .map_err(|e| format!("复制文件失败: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&dest)
            .map_err(|e| format!("获取文件属性失败: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&dest, perms)
            .map_err(|e| format!("设置执行权限失败: {}", e))?;
    }
    Ok(dest.to_string_lossy().to_string())
}
#[command]
pub fn mp_start_openp2p_host(room_name: String) -> Result<String, String> {
    let args = ["-d", "-node", &room_name, "-token", "11661058147873189554"];
    start_openp2p_with_args(&args)
}
#[command]
pub fn mp_encode_room_info(room_name: String, port_count: String) -> String {
    use base64::{Engine as _, engine::general_purpose};
    let combined = format!("{},{}", room_name, port_count);
    general_purpose::STANDARD.encode(combined)
}
#[command]
pub fn mp_start_openp2p_join(encoded_value: String, player_name: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose};
    let decoded = general_purpose::STANDARD
        .decode(&encoded_value)
        .map_err(|e| format!("Base64 解码失败: {}", e))?;
    let decoded_str = String::from_utf8(decoded)
        .map_err(|e| format!("解码后的字节不是有效的 UTF-8 字符串: {}", e))?;
    let parts: Vec<&str> = decoded_str.split(',').collect();
    if parts.len() != 2 {
        return Err("解码后的字符串格式不正确，应为: 房间名,端口号".to_string());
    }
    let room_name = parts[0];
    let port = parts[1];
    let args = [
        "-d",
        "-node",
        &player_name,
        "-token",
        "11661058147873189554",
        "-appname",
        "RTlauncher",
        "-peernode",
        room_name,
        "-dstip",
        "127.0.0.1",
        "-dstport",
        port,
        "-srcport",
        port,
        "-protocol",
        "tcp",
    ];
    start_openp2p_with_args(&args)
}
fn kill_all_openp2p_processes() {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use winapi::um::winbase::CREATE_NO_WINDOW;
        const MAX_ATTEMPTS: u64 = 8;
        for attempt in 0..MAX_ATTEMPTS {
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/IM", "openp2p.exe"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/IM", "openp2p"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            let _ = Command::new("wmic")
                .args(["process", "where", "name='openp2p.exe'", "delete"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            let _ = Command::new("wmic")
                .args(["process", "where", "name='openp2p'", "delete"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            if let Ok(output) = Command::new("tasklist")
                .args(["/FO", "CSV", "/NH"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
            {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let lower = line.to_lowercase();
                    if lower.contains("openp2p") {
                        let parts: Vec<&str> = line.split("\",\"").collect();
                        if parts.len() >= 2 {
                            if let Ok(pid) = parts[1].parse::<u32>() {
                                let _ = Command::new("taskkill")
                                    .args(["/F", "/PID", &pid.to_string()])
                                    .creation_flags(CREATE_NO_WINDOW)
                                    .output();
                                let _ = Command::new("taskkill")
                                    .args(["/F", "/T", "/PID", &pid.to_string()])
                                    .creation_flags(CREATE_NO_WINDOW)
                                    .output();
                            }
                        }
                    }
                }
            }
            thread::sleep(std::time::Duration::from_millis(150 + attempt * 50));
            if let Ok(output) = Command::new("tasklist")
                .args(["/FO", "CSV", "/NH"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
            {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if !stdout.to_lowercase().contains("openp2p") {
                    return;
                }
            }
        }
        let _ = Command::new("cmd")
            .args(["/C", "taskkill /F /T /IM openp2p.exe & taskkill /F /T /IM openp2p & wmic process where name=\"openp2p.exe\" delete"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
    #[cfg(target_os = "linux")]
    {
        const MAX_ATTEMPTS: u64 = 6;
        for attempt in 0..MAX_ATTEMPTS {
            let _ = Command::new("killall").args(["-9", "openp2p"]).output();
            let _ = Command::new("pkill").args(["-9", "-f", "openp2p"]).output();
            if let Ok(output) = Command::new("sh")
                .args(["-c", "ps aux | grep -i openp2p | grep -v grep"])
                .output()
            {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        if let Ok(pid) = parts[1].parse::<i32>() {
                            let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
                        }
                    }
                }
            }
            thread::sleep(std::time::Duration::from_millis(150 + attempt * 50));
            if let Ok(output) = Command::new("sh")
                .args(["-c", "pgrep -l openp2p || true"])
                .output()
            {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if stdout.trim().is_empty() {
                    return;
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        const MAX_ATTEMPTS: u32 = 6;
        for attempt in 0..MAX_ATTEMPTS {
            let _ = Command::new("killall").args(["-9", "openp2p"]).output();
            let _ = Command::new("pkill").args(["-9", "-f", "openp2p"]).output();
            if let Ok(output) = Command::new("sh")
                .args(["-c", "ps aux | grep -i openp2p | grep -v grep"])
                .output()
            {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        if let Ok(pid) = parts[1].parse::<i32>() {
                            let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
                        }
                    }
                }
            }
            thread::sleep(std::time::Duration::from_millis(150 + attempt * 50));
            if let Ok(output) = Command::new("sh")
                .args(["-c", "pgrep openp2p || true"])
                .output()
            {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if stdout.trim().is_empty() {
                    return;
                }
            }
        }
    }
}
#[command]
pub fn mp_stop_openp2p() -> Result<(), String> {
    let working_dir = get_openp2p_dir().ok();
    append_log_str("[RTLauncher] 正在停止 openp2p 进程（含保护线程）...\n");
    {
        if let Ok(mut guard) = OPENP2P_PROCESS.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
            *guard = None;
        }
    }
    kill_all_openp2p_processes();
    thread::sleep(std::time::Duration::from_millis(300));
    if let Some(dir) = &working_dir {
        clear_openp2p_log_files(dir);
    }
    set_runas_mode(false);
    append_log_str("[RTLauncher] ✅ openp2p 进程（含所有保护线程）已终止\n");
    Ok(())
}
#[command]
pub fn mp_is_openp2p_running() -> bool {
    if is_runas_mode() {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            use winapi::um::winbase::CREATE_NO_WINDOW;
            match Command::new("tasklist")
                .args(["/FI", "IMAGENAME eq openp2p.exe", "/NH"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
            {
                Ok(output) => {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    return stdout.contains("openp2p.exe");
                }
                Err(_) => return false,
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            return false;
        }
    }
    let mut guard = match OPENP2P_PROCESS.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(Some(status)) => {
                append_log_str(&format!(
                    "[RTLauncher] ⚠ openp2p 进程已退出 (状态: {})\n",
                    status
                ));
                *guard = None;
                false
            }
            Ok(None) => true,
            Err(e) => {
                append_log_str(&format!("[RTLauncher] 检查进程状态失败: {}\n", e));
                false
            }
        }
    } else {
        false
    }
}
#[command]
pub fn mp_poll_log() -> String {
    let mut guard = match LOG_BUFFER.lock() {
        Ok(g) => g,
        Err(_) => return String::new(),
    };
    if guard.is_empty() {
        return String::new();
    }
    let content = String::from_utf8_lossy(&guard).to_string();
    guard.clear();
    content
}
#[command]
pub fn mp_get_openp2p_dir() -> String {
    get_openp2p_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| String::new())
}
#[command]
pub fn mp_get_openp2p_path() -> String {
    get_openp2p_path()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| String::new())
}
pub fn ensure_openp2p_stopped() {
    {
        if let Ok(mut guard) = OPENP2P_PROCESS.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
            *guard = None;
        }
    }
    kill_all_openp2p_processes();
    set_runas_mode(false);
}