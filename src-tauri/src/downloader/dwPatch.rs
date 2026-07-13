use crate::downloader::original_dwl::process_version;
use crate::handler::config::{get_launcher_paths_config, LauncherPathsConfig};
use serde::Serialize;
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
pub fn get_minecraft_dir() -> Result<PathBuf, String> {
    let config = get_launcher_paths_config();
    minecraft_dir_from_config(&config)
}

fn minecraft_dir_from_config(config: &LauncherPathsConfig) -> Result<PathBuf, String> {
    if config.selected_minecraft_path.trim().is_empty() {
        return Err("未配置 Minecraft 游戏目录".to_string());
    }

    Ok(PathBuf::from(&config.selected_minecraft_path))
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

#[cfg(test)]
mod tests {
    use super::minecraft_dir_from_config;
    use crate::handler::config::LauncherPathsConfig;
    use std::collections::HashMap;
    use std::path::PathBuf;

    #[test]
    fn download_directory_uses_selected_minecraft_path() {
        let config = LauncherPathsConfig {
            java_paths: Vec::new(),
            selected_java_path: String::new(),
            java_installations: HashMap::new(),
            minecraft_paths: vec!["old-default".to_string(), "new-selected".to_string()],
            selected_minecraft_path: "new-selected".to_string(),
            default_minecraft_path: "old-default".to_string(),
        };

        assert_eq!(
            minecraft_dir_from_config(&config),
            Ok(PathBuf::from("new-selected"))
        );
    }
}
