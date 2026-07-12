//! 下载器共享工具模块
//! 
//! 提取各 mod loader installer 中的通用代码，减少重复。

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json;
use std::path::PathBuf;

// ============= 通用结构体定义 =============

#[derive(Debug, Deserialize, Clone)]
pub struct Library {
    pub name: String,
    pub url: Option<String>,
    pub downloads: Option<LibraryDownloads>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct LibraryDownloads {
    pub artifact: Option<Artifact>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Artifact {
    pub path: String,
    pub sha1: String,
    pub size: u64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct GameVersion {
    pub version: String,
    pub stable: bool,
}

#[derive(Debug, Deserialize, Clone)]
pub struct LoaderVersion {
    pub separator: String,
    pub build: u64,
    pub maven: String,
    pub version: String,
    #[serde(default)]
    pub stable: bool,
}

#[derive(Debug, Deserialize, Clone)]
pub struct MetaResponse {
    pub game: Vec<GameVersion>,
    pub loader: Vec<LoaderVersion>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct BmclEntry {
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub build: Option<String>,
    #[serde(default)]
    pub mcversion: Option<String>,
}

// ============= Maven 坐标解析 =============

/// 解析 Maven 坐标字符串："groupId:artifactId:version[:classifier][@extension]"
/// 返回 `(group_path, artifact_id, version, classifier, extension)`
pub fn parse_maven_coordinate(coord: &str) -> Result<(String, String, String, Option<String>, String)> {
    let (coord_clean, ext) = match coord.rsplit_once('@') {
        Some((c, e)) => (c, e.to_string()),
        None => (coord, "jar".to_string()),
    };

    let parts: Vec<&str> = coord_clean.split(':').collect();
    if parts.len() < 3 {
        return Err(anyhow!("无效 Maven 坐标: {}", coord));
    }

    let group_id = parts[0];
    let artifact_id = parts[1];
    let version = parts[2];
    let classifier = parts.get(3).map(|s| s.to_string());

    let group_path = group_id.replace('.', "/");
    Ok((group_path, artifact_id.to_string(), version.to_string(), classifier, ext))
}

/// 解析库文件路径为文件系统路径
/// 返回：(父目录路径, 文件名)
pub fn parse_library_path_for_fs(name: &str) -> Result<(PathBuf, String)> {
    let (group_path, artifact_id, version, classifier, ext) = parse_maven_coordinate(name)?;
    
    let mut path = PathBuf::new();
    path.push(group_path.replace('/', &std::path::MAIN_SEPARATOR.to_string()));
    path.push(&artifact_id);
    path.push(&version);

    let jar_name = match classifier {
        Some(c) => format!("{}-{}-{}.{}", artifact_id, version, c, ext),
        None => format!("{}-{}.{}", artifact_id, version, ext),
    };
    
    Ok((path, jar_name))
}

/// 解析库文件路径为 URL 路径
pub fn parse_library_path_for_url(name: &str) -> Result<String> {
    let (group_path, artifact_id, version, classifier, ext) = parse_maven_coordinate(name)?;
    
    let jar_name = match classifier {
        Some(c) => format!("{}-{}-{}.{}", artifact_id, version, c, ext),
        None => format!("{}-{}.{}", artifact_id, version, ext),
    };
    
    Ok(format!("{}/{}/{}/{}", group_path, artifact_id, version, jar_name))
}

// ============= 版本列表获取工具 =============

/// 从 BMCLAPI 风格的 JSON 响应中提取版本列表
pub fn parse_bmcl_versions(list: Vec<BmclEntry>, mc_version: &str) -> Vec<String> {
    let mut versions: Vec<String> = list
        .into_iter()
        .filter(|e| {
            e.mcversion
                .as_ref()
                .map(|v| v == mc_version)
                .unwrap_or_else(|| e.version.contains(mc_version))
        })
        .map(|e| {
            let forge_ver = e.build.unwrap_or(e.version);
            format!("{}-{}", mc_version, forge_ver)
        })
        .collect();
    versions.sort_by(|a, b| b.cmp(a));
    versions.dedup();
    versions
}

/// 从 Meta 响应中提取 Loader 版本列表
pub fn parse_meta_versions(meta: MetaResponse, mc_version: &str) -> Result<Vec<String>> {
    if !meta.game.iter().any(|g| g.version == mc_version) {
        return Err(anyhow!("MC版本 {} 不存在于元数据中", mc_version));
    }
    let loader_versions = meta.loader.into_iter().map(|l| l.version).collect();
    Ok(loader_versions)
}

// ============= XML 版本解析工具 =============

/// 从 Maven metadata.xml 中提取版本列表（适用于 Fabric API、Quilt API 等）
pub fn parse_maven_metadata(xml_text: &str) -> Result<Vec<String>> {
    use regex::Regex;
    
    // 匹配 <version>xxx</version> 标签
    let re = Regex::new(r"<version>([^<]+)</version>")?;
    let mut versions: Vec<String> = re
        .find_iter(xml_text)
        .filter_map(|m| m.as_str().strip_prefix("<version>")?.strip_suffix("</version>"))
        .map(|s| s.trim().to_string())
        .collect();
    
    // 过滤掉 SNAPSHOT 版本（通常不需要）
    versions.retain(|v| !v.contains("SNAPSHOT"));
    // 按版本号倒序排序
    versions.sort_by(|a, b| compare_versions(b, a));
    versions.dedup();
    
    Ok(versions)
}

/// 比较版本字符串（简单实现，适用于大多数情况）
pub fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let parse_version = |v: &str| -> Vec<i32> {
        v.split(|c: char| !c.is_ascii_digit())
            .filter(|s| !s.is_empty())
            .filter_map(|s| s.parse::<i32>().ok())
            .collect()
    };
    
    let a_parts = parse_version(a);
    let b_parts = parse_version(b);
    
    a_parts.cmp(&b_parts)
}

// ============= JSON 工具 =============

/// 安全解析 JSON，返回 Option 而不是 Result
pub fn safe_json_parse<T: serde::de::DeserializeOwned>(text: &str) -> Option<T> {
    serde_json::from_str(text).ok()
}

/// 安全解析 JSON，带错误信息
pub fn json_parse_with_error<T: serde::de::DeserializeOwned>(text: &str, context: &str) -> Result<T> {
    serde_json::from_str(text).with_context(|| format!("解析 JSON 失败 ({})", context))
}