use crate::downloader::optifine_installer;
use crate::downloader::original_dwl::process_version;
use crate::downloader::dwPatch::get_minecraft_dir;
use crate::downloader::shared_utils::{sanitize_instance_name, merge_version_jsons_to_instance};
use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize)]
pub struct OptifineInstallResult {
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OptifineVersion {
    pub id: String,
    pub filename: String,
}

#[derive(Clone, Serialize)]
struct OptifineDownloadProgressPayload {
    task_id: u64,
    percent: f64,
}

#[derive(Clone, Serialize)]
struct OptifineDownloadFinishedPayload {
    task_id: u64,
    success: bool,
    error: Option<String>,
}

static OPTIFINE_TASK_COUNTER: AtomicU64 = AtomicU64::new(1000000);

struct OptifineActiveTaskInfo {
    cancel: Arc<AtomicBool>,
    mc_version: String,
    optifine_version: String,
}

fn optifine_active_tasks() -> &'static Mutex<HashMap<u64, OptifineActiveTaskInfo>> {
    static INSTANCE: OnceLock<Mutex<HashMap<u64, OptifineActiveTaskInfo>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 获取指定Minecraft版本的Optifine版本列表
#[tauri::command]
pub async fn get_optifine_versions(
    mc_version: String,
) -> Result<Vec<OptifineVersion>, String> {
    let version_names = get_optifine_version_names(mc_version).await?;
    Ok(version_names.into_iter().map(|filename| OptifineVersion {
        id: filename.clone(),
        filename,
    }).collect())
}

/// 获取指定Minecraft版本的Optifine版本列表
#[tauri::command]
pub async fn get_optifine_version_names(
    mc_version: String,
) -> Result<Vec<String>, String> {
    let url = "https://optifine.net/downloads";
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("构造 reqwest 客户端失败: {}", e))?;

    let resp = client.get(url).send().await
        .map_err(|e| format!("请求 OptiFine Downloads 页面失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("请求失败, HTTP 状态码: {}", resp.status()));
    }

    let html = resp.text().await
        .map_err(|e| format!("读取 HTML 内容失败: {}", e))?;

    // 匹配指定 MC 版本下的所有 OptiFine 版本
    // 首先找到对应版本的 h2 标签
    let version_pattern = format!(r#"<h2>Minecraft {}</h2>"#, mc_version.replace(".", r"\."));
    let version_re = Regex::new(&version_pattern).map_err(|e| format!("构建正则表达式失败: {}", e))?;

    // 匹配该版本下的所有下载链接
    let link_re = Regex::new(r#"href=['"]http://optifine\.net/adloadx\?f=([^'"]+)['"]"#)
        .map_err(|e| format!("构建正则表达式失败: {}", e))?;

    let mut versions = Vec::new();

    // 找到版本标题的位置
    if let Some(version_pos) = version_re.find(&html) {
        // 获取从版本标题开始的内容
        let content = &html[version_pos.start()..];

        // 查找下一个版本标题的位置，以确定当前版本内容的结束位置
        let next_version_re = Regex::new(r#"<h2>Minecraft \d+\.\d+\.\d+</h2>"#)
            .map_err(|e| format!("构建正则表达式失败: {}", e))?;
        let end_pos = if let Some(next_match) = next_version_re.find(&content[version_pattern.len()..]) {
            version_pattern.len() + next_match.start()
        } else {
            content.len()
        };

        // 提取当前版本的内容
        let version_content = &content[..end_pos];

        // 提取所有下载链接中的文件名
        for caps in link_re.captures_iter(version_content) {
            if let Some(filename) = caps.get(1) {
                versions.push(filename.as_str().to_string());
            }
        }
    }

    Ok(versions)
}

/// 下载并安装指定版本的Optifine
#[tauri::command]
pub async fn install_optifine(
    optifine_version: String,
    minecraft_dir: String,
    mc_version: String,
    _window: tauri::Window,
) -> Result<OptifineInstallResult, String> {
    // 获取wrapper路径
    let current_dir = std::env::current_dir()
        .map_err(|e| format!("获取当前目录失败: {}", e))?;
    let rtl_path = current_dir.join("RTL");
    let config_dir = rtl_path.join("config");
    let opt_wrapper_path = config_dir.join("optWrapper.jar")
        .to_string_lossy()
        .to_string();
    
    // mc_version 参数由前端传入，无需从 optifine_version 中提取
    let version_name = optifine_version.clone();
    
    tokio::task::spawn_blocking(move || {
        optifine_installer::install_optifine_alone(
            &optifine_version,
            &minecraft_dir,
            &opt_wrapper_path,
            &mc_version,
        )
    })
    .await
    .map_err(|e| format!("安装 OptiFine 失败: {}", e))?
    .map_err(|e| e.to_string())?;

    Ok(OptifineInstallResult {
        message: format!("OptiFine {} 已成功安装", version_name)
    })
}

/// 下载并安装指定版本的Optifine（带进度显示）
#[tauri::command]
pub async fn download_and_install_optifine(
    app: AppHandle,
    optifine_version: String,
    mc_version: String,
    instance_name: Option<String>,
) -> Result<u64, String> {
    let task_id = OPTIFINE_TASK_COUNTER.fetch_add(1, Ordering::SeqCst);
    let minecraft_path = get_minecraft_dir()?;
    std::fs::create_dir_all(&minecraft_path).map_err(|e| format!("创建目录失败: {}", e))?;

    let (tx, mut rx) = tokio::sync::mpsc::channel::<f64>(64);
    let cancel = Arc::new(AtomicBool::new(false));

    // 注册活跃任务
    {
        let mut tasks = optifine_active_tasks().lock().unwrap();
        tasks.insert(task_id, OptifineActiveTaskInfo {
            cancel: cancel.clone(),
            mc_version: mc_version.clone(),
            optifine_version: optifine_version.clone(),
        });
    }

    // 接收进度并通过 Tauri 事件发送到前端
    let app_clone = app.clone();
    let task_id_clone = task_id;
    tokio::spawn(async move {
        while let Some(percent) = rx.recv().await {
            let _ = app_clone.emit("optifine-download-progress", OptifineDownloadProgressPayload {
                task_id: task_id_clone,
                percent,
            });
        }
    });

    // 立即发送初始进度事件，减少从点击到开始下载的等待时间
    let _ = app.emit("optifine-download-progress", OptifineDownloadProgressPayload {
        task_id,
        percent: 0.0,
    });

    let app_finish = app.clone();
    let version = mc_version.clone();
    let optifine_ver = optifine_version.clone();
    let cancel_clone = cancel.clone();
    let minecraft_path_clone = minecraft_path.clone();
    let instance_name_cloned = instance_name.clone();

    tokio::spawn(async move {
        // 阶段1: 下载原版 Minecraft (0-50%)
        let result = {
            let (tx1, mut rx1) = tokio::sync::mpsc::channel::<f64>(64);
            let tx_clone = tx.clone();

            // 转发原版下载进度到总进度 (0-50%)
            tokio::spawn(async move {
                while let Some(percent) = rx1.recv().await {
                    let _ = tx_clone.send(percent * 0.5).await;
                }
            });

            process_version(&version, &minecraft_path_clone, tx1, cancel_clone.clone()).await
        };

        // 等待10秒后再开始下载OptiFine
        tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

        if cancel_clone.load(Ordering::SeqCst) {
            // 被取消
            let _ = app_finish.emit("optifine-download-finished", OptifineDownloadFinishedPayload {
                task_id,
                success: false,
                error: Some("已取消".to_string()),
            });
            return;
        }

        if result.is_err() {
            // 原版下载失败
            let error_msg = result.unwrap_err();
            let _ = app_finish.emit("optifine-download-finished", OptifineDownloadFinishedPayload {
                task_id,
                success: false,
                error: Some(format!("原版下载失败: {}", error_msg)),
            });
            return;
        }

        // 阶段2: 安装 OptiFine (50-100%)
        let install_result = {
            // 获取wrapper路径
            let current_dir = std::env::current_dir()
                .map_err(|e| format!("获取当前目录失败: {}", e));

            if let Err(e) = current_dir {
                let _ = app_finish.emit("optifine-download-finished", OptifineDownloadFinishedPayload {
                    task_id,
                    success: false,
                    error: Some(e),
                });
                return;
            }

            let rtl_path = current_dir.unwrap().join("RTL");
            let config_dir = rtl_path.join("config");
            let opt_wrapper_path = config_dir.join("optWrapper.jar")
                .to_string_lossy()
                .to_string();

            // 发送安装开始进度
            let _ = tx.send(50.0).await;

            let minecraft_path_str = minecraft_path_clone.to_string_lossy().to_string();

            // 发送下载 OptiFine 安装器的进度
            let _ = tx.send(55.0).await;

            let optifine_ver_clone = optifine_ver.clone();
            let version_clone = version.clone();
            let install_task = tokio::task::spawn_blocking(move || {
                optifine_installer::install_optifine_alone(
                    &optifine_ver_clone,
                    &minecraft_path_str,
                    &opt_wrapper_path,
                    &version_clone,
                )
            });

            match install_task.await {
                Ok(result) => result.map_err(|e| e.to_string()),
                Err(e) => Err(format!("安装 OptiFine 失败: {}", e)),
            }
        };

        // 移除活跃任务
        {
            let mut tasks = optifine_active_tasks().lock().unwrap();
            tasks.remove(&task_id);
        }

        let was_cancelled = cancel_clone.load(Ordering::SeqCst);

        if was_cancelled {
            let _ = app_finish.emit("optifine-download-finished", OptifineDownloadFinishedPayload {
                task_id,
                success: false,
                error: Some("已取消".to_string()),
            });
        } else {
            match install_result {
                Ok(loader_version) => {
                    // 发送安装完成进度
                    let _ = tx.send(100.0).await;
                    println!("OptiFine 安装成功，发送完成事件");

                    if let Some(inst_name) = instance_name_cloned {
                        let clean_name = sanitize_instance_name(&inst_name);
                        println!("[OptiFine] 创建实例目录: {}", clean_name);
                        let default_name = format!("{}-optifine-{}", version, optifine_ver);
                        let final_name = if clean_name.trim().is_empty() {
                            sanitize_instance_name(&default_name)
                        } else {
                            clean_name
                        };
                        match merge_version_jsons_to_instance(
                            &final_name,
                            &version,
                            &optifine_ver,
                            "optifine",
                            &minecraft_path_clone,
                        ) {
                            Ok(_) => println!("[OptiFine] 实例 JSON 合并完成: {}", final_name),
                            Err(e) => println!("[OptiFine] 警告: 合并实例 JSON 失败: {}", e),
                        }
                    }

                    let _ = app_finish.emit("optifine-download-finished", OptifineDownloadFinishedPayload {
                        task_id,
                        success: true,
                        error: None,
                    });
                }
                Err(e) => {
                    println!("OptiFine 安装失败: {}", e);
                    let _ = app_finish.emit("optifine-download-finished", OptifineDownloadFinishedPayload {
                        task_id,
                        success: false,
                        error: Some(e),
                    });
                }
            }
        }
    });

    Ok(task_id)
}

/// 取消OptiFine下载任务
#[tauri::command]
pub async fn cancel_optifine_download(taskId: u64) -> Result<(), String> {
    let tasks = optifine_active_tasks().lock().map_err(|e| e.to_string())?;
    if let Some(info) = tasks.get(&taskId) {
        info.cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}