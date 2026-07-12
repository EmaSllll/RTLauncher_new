use crate::downloader::{
    concurrent_download::{self, DownloadTask},
    mod_loader_installer_shared as shared,
};
use crate::http_client::shared_client;
use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use std::path::PathBuf;
#[derive(Debug, Deserialize, Clone)]
struct NeoForgeBmclEntry {
    #[serde(default)]
    version: String,
    #[serde(default)]
    build: Option<String>,
}
async fn fetch_bmcl_neoforge_versions(mc_version: &str) -> Option<Vec<String>> {
    let client = shared_client().await;
    let url = format!(
        "https://bmclapi2.bangbang93.com/forge/neo/{}/versions",
        mc_version
    );
    let text = client.get(&url).send().await.ok()?.text().await.ok()?;
    if let Ok(list) = serde_json::from_str::<Vec<NeoForgeBmclEntry>>(&text) {
        if !list.is_empty() {
            let mut versions: Vec<String> = list
                .into_iter()
                .map(|e| e.build.unwrap_or(e.version))
                .collect();
            versions.sort_by(|a, b| b.cmp(a));
            versions.dedup();
            return Some(versions);
        }
    }
    None
}
#[derive(Debug, Deserialize, Clone)]
struct NeoForgeMetaResponse {
    #[serde(default)]
    latest: Option<serde_json::Value>,
}
async fn fetch_official_neoforge_versions(mc_version: &str) -> Result<Vec<String>> {
    let client = shared_client().await;
    let latest_url = "https://meta.neoforged.net/v1/versions/forge";
    let resp = client
        .get(latest_url)
        .send()
        .await
        .context("Failed to request NeoForge latest metadata")?;
    let latest: NeoForgeMetaResponse = resp
        .json()
        .await
        .context("解析 NeoForge latest 元数据失败")?;
    let Some(obj) = latest.latest else {
        return Err(anyhow!("NeoForge latest 元数据为空"));
    };
    if let Some(map) = obj.as_object() {
        if let Some(v) = map.get(mc_version).and_then(|v| v.as_str()) {
            return Ok(vec![v.to_string()]);
        }
        for (k, v) in map {
            if k.starts_with(mc_version) {
                if let Some(s) = v.as_str() {
                    return Ok(vec![s.to_string()]);
                }
            }
        }
        let mut versions: Vec<String> = map
            .values()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        versions.sort_by(|a, b| b.cmp(a));
        versions.dedup();
        if !versions.is_empty() {
            return Ok(versions);
        }
    }
    Err(anyhow!(
        "未在 NeoForge latest 元数据中找到 Minecraft {} 的加载器版本",
        mc_version
    ))
}
pub async fn get_neoforge_versions(mc_version: &str) -> Result<Vec<String>> {
    if let Some(v) = fetch_bmcl_neoforge_versions(mc_version).await {
        return Ok(v);
    }
    fetch_official_neoforge_versions(mc_version).await
}
async fn download_installer(
    neoforge_version: &str,
    mc_dir: &PathBuf,
) -> Result<PathBuf> {
    let cache_dir = mc_dir.join("cache").join("neoforge_installer");
    std::fs::create_dir_all(&cache_dir).ok();
    let file_name = format!("neoforge-{}-installer.jar", neoforge_version);
    let target_path = cache_dir.join(&file_name);
    if target_path.exists() {
        return Ok(target_path);
    }
    let urls = vec![
        format!(
            "https://maven.neoforged.net/releases/net/neoforged/forge/{}/forge-{}-installer.jar",
            neoforge_version, neoforge_version
        ),
        format!(
            "https://bmclapi2.bangbang93.com/maven/net/neoforged/forge/{}/forge-{}-installer.jar",
            neoforge_version, neoforge_version
        ),
    ];
    let task = DownloadTask {
        file_name: file_name.clone(),
        target_dir: cache_dir,
        urls,
        sha1: None,
    };
    concurrent_download::download_one(task).await.with_context(|| {
        format!("下载 NeoForge Installer JAR 失败: {}", file_name)
    })
}
pub async fn install_neoforge(
    mc_version: &str,
    neoforge_version: &str,
    mc_dir: &str,
    java_path: &str,
    progress_tx: Option<tokio::sync::mpsc::Sender<f64>>,
    wait_for_original: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
) -> Result<String> {
    let mc_path = PathBuf::from(mc_dir);
    let installer_jar = download_installer(neoforge_version, &mc_path).await?;
    let java_executable = if java_path.is_empty() {
        let auto = shared::pick_java_executable(mc_version);
        println!("[NeoForge] 自动探测 Java: {} (java_path 为空)", auto);
        auto
    } else {
        java_path.to_string()
    };
    let cfg = shared::LoaderInstallerConfig {
        installer_jar_path: installer_jar,
        java_executable_path: PathBuf::from(java_executable),
        mc_version: mc_version.to_string(),
        mc_version_id: mc_version.to_string(),
        library_mirrors: vec![
            "https://maven.neoforged.net/releases/".to_string(),
            "https://bmclapi2.bangbang93.com/maven/".to_string(),
            "https://files.minecraftforge.net/maven/".to_string(),
            "https://libraries.minecraft.net/".to_string(),
        ],
    };
    shared::install(&cfg, &mc_path, progress_tx, wait_for_original).await
}