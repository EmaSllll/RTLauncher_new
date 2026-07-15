use crate::downloader::original_dwl::process_version;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};
static TASK_COUNTER: AtomicU64 = AtomicU64::new(1);
struct ActiveTaskInfo {
    cancel: Arc<AtomicBool>,
    #[allow(dead_code)]
    mc_version: String,
    #[allow(dead_code)]
    minecraft_path: PathBuf,
}
fn active_tasks() -> &'static Mutex<HashMap<u64, ActiveTaskInfo>> {
    static INSTANCE: OnceLock<Mutex<HashMap<u64, ActiveTaskInfo>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(HashMap::new()))
}
#[derive(Clone, Serialize)]
struct DownloadProgressPayload {
    task_id: u64,
    percent: f64,
}
#[derive(Clone, Serialize)]
struct DownloadFinishedPayload {
    task_id: u64,
    success: bool,
    error: Option<String>,
    failed_count: usize,
}
/// 获取平台默认游戏目录（作为 get_minecraft_dir 的回退值）
pub fn default_minecraft_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        return PathBuf::from(format!("{}/Library/Application Support/minecraft", home));
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        return PathBuf::from(format!("{}/.minecraft", home));
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join(".minecraft");
        }
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));
        return exe_dir.join(".minecraft");
    }
}

/// 获取 launcher.json 的配置路径
fn launcher_config_path() -> PathBuf {
    #[cfg(target_os = "macos")]
    let dir = {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(format!("{}/Library/Application Support/RTLauncher/config", home))
    };
    #[cfg(not(target_os = "macos"))]
    let dir = PathBuf::from("./RTL/config");

    let _ = std::fs::create_dir_all(&dir);
    dir.join("launcher.json")
}

/// 从 launcher.json 读取 selected_minecraft_path
fn read_selected_minecraft_path_from_config() -> Option<String> {
    let path = launcher_config_path();
    if !path.exists() {
        return None;
    }
    let text = std::fs::read_to_string(&path).ok()?;
    #[derive(Deserialize)]
    struct Cfg {
        selected_minecraft_path: Option<String>,
    }
    let cfg: Cfg = serde_json::from_str(&text).ok()?;
    cfg.selected_minecraft_path.filter(|s| !s.is_empty())
}

/// 获取当前游戏目录。
/// 优先级：launcher.json -> selected_minecraft_path > 平台默认路径
pub fn get_minecraft_dir() -> Result<PathBuf, String> {
    // 优先使用用户在启动页选择的路径（持久化到 launcher.json）
    if let Some(selected) = read_selected_minecraft_path_from_config() {
        return Ok(PathBuf::from(selected));
    }
    // 回退到平台默认路径
    Ok(default_minecraft_dir())
}
#[tauri::command]
pub async fn download_patcher(app: AppHandle, mcVersion: String) -> Result<u64, String> {
    let task_id = TASK_COUNTER.fetch_add(1, Ordering::SeqCst);
    let minecraft_path = get_minecraft_dir()?;
    std::fs::create_dir_all(&minecraft_path).map_err(|e| format!("创建目录失败: {}", e))?;
    let (tx, mut rx) = tokio::sync::mpsc::channel::<f64>(64);
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut tasks = active_tasks().lock().unwrap();
        tasks.insert(task_id, ActiveTaskInfo {
            cancel: cancel.clone(),
            mc_version: mcVersion.clone(),
            minecraft_path: minecraft_path.clone(),
        });
    }
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(percent) = rx.recv().await {
            let _ = app_clone.emit("download-progress", DownloadProgressPayload { task_id, percent });
        }
    });
    let app_finish = app.clone();
    let version = mcVersion.clone();
    let cancel_clone = cancel.clone();
    tokio::spawn(async move {
        let result = process_version(&version, &minecraft_path, tx, cancel_clone.clone()).await;
        {
            let mut tasks = active_tasks().lock().unwrap();
            tasks.remove(&task_id);
        }
        let was_cancelled = cancel_clone.load(Ordering::SeqCst);
        if was_cancelled {
            let version_dir = minecraft_path.join("versions").join(&version);
            let _ = std::fs::remove_dir_all(&version_dir);
            let _ = app_finish.emit("download-finished", DownloadFinishedPayload {
                task_id,
                success: false,
                error: Some("已取消".to_string()),
                failed_count: 0,
            });
        } else {
            match result {
                Ok(warnings) => {
                    let failed_count = warnings.len();
                    let _ = app_finish.emit("download-finished", DownloadFinishedPayload {
                        task_id,
                        success: true,
                        error: if failed_count > 0 {
                            Some(format!("{} 个文件下载失败", failed_count))
                        } else {
                            None
                        },
                        failed_count,
                    });
                }
                Err(e) => {
                    let _ = app_finish.emit("download-finished", DownloadFinishedPayload {
                        task_id,
                        success: false,
                        error: Some(e.to_string()),
                        failed_count: 0,
                    });
                }
            }
        }
    });
    Ok(task_id)
}
#[tauri::command]
pub async fn cancel_download(taskId: u64) -> Result<(), String> {
    let tasks = active_tasks().lock().map_err(|e| e.to_string())?;
    if let Some(info) = tasks.get(&taskId) {
        info.cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}