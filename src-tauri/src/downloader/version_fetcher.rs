use serde::{Deserialize, Serialize};
use futures::stream::FuturesUnordered;
use futures::StreamExt;

const MOJANG_MANIFEST: &str = "https://launchermeta.mojang.com/mc/game/version_manifest.json";
const BMCL_MANIFEST: &str = "https://bmclapi2.bangbang93.com/mc/game/version_manifest.json";

#[derive(Debug, Deserialize)]
struct VersionManifest {
    versions: Vec<VersionEntry>,
}
#[derive(Debug, Deserialize)]
struct VersionEntry {
    id: String,
    #[serde(rename = "type")]
    version_type: String,
    #[serde(rename = "releaseTime")]
    time: String,
}
#[derive(Debug, Serialize)]
pub struct VersionInfo {
    pub id: String,
    #[serde(rename = "releaseTime")]
    pub release_time: String,
}

/// 从多个镜像源并行请求 JSON 数据，谁先成功返回谁
/// 如果某个源失败，会继续等待其他源；所有源均失败才返回错误
async fn fetch_json_parallel<T: for<'de> Deserialize<'de> + 'static>(
    urls: &[&str],
) -> Result<T, String> {
    let client = crate::http_client::shared_client().await;

    let mut futures = FuturesUnordered::new();
    for url in urls {
        let c = client.clone();
        let u = url.to_string();
        futures.push(async move {
            let resp = c
                .get(&u)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let resp = resp.error_for_status().map_err(|e| e.to_string())?;
            let json: T = resp.json().await.map_err(|e| e.to_string())?;
            Ok::<T, String>(json)
        });
    }

    let mut last_err: Option<String> = None;
    while let Some(result) = futures.next().await {
        match result {
            Ok(data) => return Ok(data),
            Err(e) => {
                last_err = Some(e);
            }
        }
    }

    Err(last_err.unwrap_or_else(|| "所有镜像源均请求失败".to_string()))
}

#[tauri::command]
pub async fn classify_minecraft_versions() -> Result<[Vec<VersionInfo>; 4], String> {
    // 双源并行请求：官方源 + BMCL 镜像，谁先成功就用谁
    let manifest: VersionManifest = fetch_json_parallel(&[MOJANG_MANIFEST, BMCL_MANIFEST])
        .await
        .map_err(|e| e.to_string())?;

    let mut releases = Vec::new();
    let mut snapshots = Vec::new();
    let mut april_fools = Vec::new();
    let mut old_versions = Vec::new();
    for entry in manifest.versions {
        let info = VersionInfo {
            id: entry.id.clone(),
            release_time: entry.time.clone(),
        };
        if matches!(entry.version_type.as_str(), "old_alpha" | "old_beta") {
            old_versions.push(info);
            continue;
        }
        if entry.time.contains("-04-01") {
            april_fools.push(info);
            continue;
        }
        match entry.version_type.as_str() {
            "release" => releases.push(info),
            "snapshot" => snapshots.push(info),
            _ => {}
        }
    }
    Ok([releases, snapshots, april_fools, old_versions])
}