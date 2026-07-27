use serde::{Deserialize, Serialize};
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
#[tauri::command]
pub async fn classify_minecraft_versions() -> Result<[Vec<VersionInfo>; 4], String> {
    let response = reqwest::get("https://launchermeta.mojang.com/mc/game/version_manifest.json")
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let manifest: VersionManifest = response.json().await.map_err(|e| e.to_string())?;
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