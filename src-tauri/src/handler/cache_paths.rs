use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use serde_json;

/// 与 config.rs 中一致的 config 目录定位逻辑（支持 Windows / macOS / 其它）
fn get_config_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        return PathBuf::from("./RTL/config");
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        return PathBuf::from(format!("{}/Library/Application Support/RTLauncher/config", home));
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        use crate::app_paths::linux_config_dir;
        return linux_config_dir().to_path_buf();
    }
}

/// 回退：取平台默认 Minecraft 路径（跨平台），与 config.rs 保持一致
fn fallback_minecraft_path() -> PathBuf {
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
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        return PathBuf::from(format!("{}/Library/Application Support/minecraft", home));
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        return PathBuf::from(format!("{}/.minecraft", home));
    }
}

/// 读取 launcher.json 中 selected_minecraft_path
fn read_selected_minecraft_path() -> Result<PathBuf, String> {
    let cfg_dir = get_config_dir();
    let cfg_path = cfg_dir.join("launcher.json");

    if cfg_path.exists() {
        match std::fs::read_to_string(&cfg_path) {
            Ok(text) => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    // 优先：selected_minecraft_path
                    if let Some(val) = json.get("selected_minecraft_path").and_then(|v| v.as_str()) {
                        let trimmed = val.trim();
                        if !trimmed.is_empty() {
                            return Ok(PathBuf::from(trimmed));
                        }
                    }
                    // 其次：default_minecraft_path
                    if let Some(val) = json.get("default_minecraft_path").and_then(|v| v.as_str()) {
                        let trimmed = val.trim();
                        if !trimmed.is_empty() {
                            return Ok(PathBuf::from(trimmed));
                        }
                    }
                    // 最后：minecraft_paths 数组第一个
                    if let Some(arr) = json.get("minecraft_paths").and_then(|v| v.as_array()) {
                        if let Some(first) = arr.first().and_then(|v| v.as_str()) {
                            let trimmed = first.trim();
                            if !trimmed.is_empty() {
                                return Ok(PathBuf::from(trimmed));
                            }
                        }
                    }
                }
            }
            Err(err) => {
                eprintln!("[cache_paths] 读取 launcher.json 失败: {}", err);
            }
        }
    }

    // 若找不到配置，回退到系统默认 .minecraft 位置（保证代码路径始终可用）
    Ok(fallback_minecraft_path())
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheResourceKind {
    Mod,
    ResourcePack,
    DataPack,
    World,
    ShaderPack,
    Modpack,
}
impl CacheResourceKind {
    pub fn dir_name(&self) -> &'static str {
        match self {
            CacheResourceKind::Mod => "mods",
            CacheResourceKind::ResourcePack => "resourcepacks",
            CacheResourceKind::DataPack => "datapacks",
            CacheResourceKind::World => "worlds",
            CacheResourceKind::ShaderPack => "shaderpacks",
            CacheResourceKind::Modpack => "modpacks",
        }
    }
    pub fn all() -> &'static [CacheResourceKind] {
        &[
            CacheResourceKind::Mod,
            CacheResourceKind::ResourcePack,
            CacheResourceKind::DataPack,
            CacheResourceKind::World,
            CacheResourceKind::ShaderPack,
            CacheResourceKind::Modpack,
        ]
    }
}
/// 调试用：返回原始 selected_minecraft_path（不追加 cache），方便前端诊断
#[tauri::command]
pub fn get_selected_minecraft_path() -> Result<String, String> {
    let p = read_selected_minecraft_path()?;
    Ok(p.to_string_lossy().to_string())
}

/// 缓存根目录：<selected_minecraft_path>/cache
pub fn cache_root_dir() -> Result<PathBuf, String> {
    let mc_path = read_selected_minecraft_path()?;
    let cache_root = mc_path.join("cache");
    std::fs::create_dir_all(&cache_root).map_err(|e| e.to_string())?;
    Ok(cache_root)
}
pub fn get_cache_dir_for_kind(kind: CacheResourceKind) -> Result<PathBuf, String> {
    let root = cache_root_dir()?;
    let dir = root.join(kind.dir_name());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
pub fn get_cache_dir_for_version(kind: CacheResourceKind, mc_version: &str) -> Result<PathBuf, String> {
    let kind_dir = get_cache_dir_for_kind(kind)?;
    let version_dir = kind_dir.join(sanitize_version(mc_version));
    std::fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;
    Ok(version_dir)
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModLoaderKind {
    Forge,
    NeoForge,
    Fabric,
    Quilt,
    LiteLoader,
    Ornithe,
    Vanilla,
    Custom(String),
}
impl ModLoaderKind {
    pub fn dir_name(&self) -> String {
        match self {
            ModLoaderKind::Forge => "forge".to_string(),
            ModLoaderKind::NeoForge => "neoforge".to_string(),
            ModLoaderKind::Fabric => "fabric".to_string(),
            ModLoaderKind::Quilt => "quilt".to_string(),
            ModLoaderKind::LiteLoader => "liteloader".to_string(),
            ModLoaderKind::Ornithe => "ornithe".to_string(),
            ModLoaderKind::Vanilla => "vanilla".to_string(),
            ModLoaderKind::Custom(name) => name.to_lowercase(),
        }
    }
}
pub fn get_mod_cache_dir(mc_version: &str, loader: ModLoaderKind) -> Result<PathBuf, String> {
    let version_dir = get_cache_dir_for_version(CacheResourceKind::Mod, mc_version)?;
    let loader_dir = version_dir.join(loader.dir_name());
    std::fs::create_dir_all(&loader_dir).map_err(|e| e.to_string())?;
    Ok(loader_dir)
}
fn sanitize_version(version: &str) -> String {
    let trimmed = version.trim();
    if trimmed.is_empty() {
        return "unknown".to_string();
    }
    trimmed
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}
pub fn ensure_all_cache_dirs() -> Result<(), String> {
    for kind in CacheResourceKind::all() {
        get_cache_dir_for_kind(*kind)?;
    }
    Ok(())
}
pub fn parse_resource_kind(kind: &str) -> Result<CacheResourceKind, String> {
    match kind.to_ascii_lowercase().as_str() {
        "mod" | "mods" => Ok(CacheResourceKind::Mod),
        "resourcepack" | "resourcepacks" => Ok(CacheResourceKind::ResourcePack),
        "datapack" | "datapacks" => Ok(CacheResourceKind::DataPack),
        "world" | "worlds" => Ok(CacheResourceKind::World),
        "shaderpack" | "shaderpacks" | "shader" => Ok(CacheResourceKind::ShaderPack),
        "modpack" | "modpacks" => Ok(CacheResourceKind::Modpack),
        other => Err(format!("未知的资源类型: {}", other)),
    }
}
pub fn parse_mod_loader(loader: &str) -> Result<ModLoaderKind, String> {
    let trimmed = loader.trim();
    if trimmed.is_empty() {
        return Ok(ModLoaderKind::Vanilla);
    }
    let lower = trimmed.to_ascii_lowercase();
    match lower.as_str() {
        "forge" => Ok(ModLoaderKind::Forge),
        "neoforge" | "neo_forge" | "neoforged" | "neoforge_21_1_99" => Ok(ModLoaderKind::NeoForge),
        "fabric" => Ok(ModLoaderKind::Fabric),
        "quilt" => Ok(ModLoaderKind::Quilt),
        "liteloader" | "lite_loader" | "litemod" => Ok(ModLoaderKind::LiteLoader),
        "ornithe" => Ok(ModLoaderKind::Ornithe),
        "vanilla" | "通用" | "common" => Ok(ModLoaderKind::Vanilla),
        _ => {
            let sanitized: String = lower
                .chars()
                .map(|c| match c {
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
                    _ => c,
                })
                .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == ' ')
                .collect();
            let sanitized = sanitized.trim();
            if sanitized.is_empty() {
                Ok(ModLoaderKind::Vanilla)
            } else {
                Ok(ModLoaderKind::Custom(sanitized.replace(" ", "_")))
            }
        }
    }
}
#[tauri::command]
pub fn get_cache_root() -> Result<String, String> {
    Ok(cache_root_dir()?.to_string_lossy().to_string())
}
#[tauri::command]
pub fn get_cache_dir(kind: String) -> Result<String, String> {
    let resource_kind = parse_resource_kind(&kind)?;
    Ok(get_cache_dir_for_kind(resource_kind)?
        .to_string_lossy()
        .to_string())
}
#[tauri::command]
pub fn get_cache_dir_by_version(kind: String, mc_version: String) -> Result<String, String> {
    let resource_kind = parse_resource_kind(&kind)?;
    Ok(get_cache_dir_for_version(resource_kind, &mc_version)?
        .to_string_lossy()
        .to_string())
}
#[tauri::command]
pub fn init_cache_dirs() -> Result<(), String> {
    ensure_all_cache_dirs()
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheDirInfo {
    pub kind: String,
    pub dir_name: String,
    pub path: String,
}
#[tauri::command]
pub fn list_cache_dirs() -> Result<Vec<CacheDirInfo>, String> {
    let mut result = Vec::new();
    for kind in CacheResourceKind::all() {
        let path = get_cache_dir_for_kind(*kind)?;
        result.push(CacheDirInfo {
            kind: kind.dir_name().to_string(),
            dir_name: kind.dir_name().to_string(),
            path: path.to_string_lossy().to_string(),
        });
    }
    Ok(result)
}
#[tauri::command]
pub fn list_cached_files(kind: String, mc_version: Option<String>) -> Result<Vec<String>, String> {
    let resource_kind = parse_resource_kind(&kind)?;
    let dir = match &mc_version {
        Some(v) => get_cache_dir_for_version(resource_kind, v)?,
        None => get_cache_dir_for_kind(resource_kind)?,
    };
    let is_world_type = matches!(resource_kind, CacheResourceKind::World);
    let mut files = Vec::new();
    match std::fs::read_dir(&dir) {
        Ok(entries) => {
            for entry in entries {
                if let Ok(entry) = entry {
                    let file_type = entry.file_type().map_err(|e| e.to_string())?;
                    if file_type.is_file() || (is_world_type && file_type.is_dir()) {
                        if let Some(name) = entry.file_name().to_str() {
                            files.push(name.to_string());
                        }
                    }
                }
            }
            files.sort();
        }
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                return Ok(Vec::new());
            }
            return Err(e.to_string());
        }
    }
    Ok(files)
}
#[tauri::command]
pub fn get_mod_cache_dir_cmd(mc_version: String, mod_loader: String) -> Result<String, String> {
    let loader = parse_mod_loader(&mod_loader)?;
    Ok(get_mod_cache_dir(&mc_version, loader)?
        .to_string_lossy()
        .to_string())
}
#[tauri::command]
pub fn list_cached_mods(mc_version: String, mod_loader: String) -> Result<Vec<String>, String> {
    let loader = parse_mod_loader(&mod_loader)?;
    let dir = get_mod_cache_dir(&mc_version, loader)?;
    let mut files = Vec::new();
    match std::fs::read_dir(&dir) {
        Ok(entries) => {
            for entry in entries {
                if let Ok(entry) = entry {
                    let file_type = entry.file_type().map_err(|e| e.to_string())?;
                    if file_type.is_file() {
                        if let Some(name) = entry.file_name().to_str() {
                            files.push(name.to_string());
                        }
                    }
                }
            }
            files.sort();
        }
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                return Ok(Vec::new());
            }
            return Err(e.to_string());
        }
    }
    Ok(files)
}
#[tauri::command]
pub fn cache_to_instance(
    kind: String,
    mc_version: String,
    mod_loader: Option<String>,
    file_name: String,
    instance_dir: String,
    instance_subdir: String,
) -> Result<(), String> {
    let resource_kind = parse_resource_kind(&kind)?;
    let src_dir = if resource_kind == CacheResourceKind::Mod {
        let loader_str = mod_loader.as_ref()
            .map(|s| s.as_str())
            .unwrap_or("forge");
        let loader = parse_mod_loader(loader_str)?;
        get_mod_cache_dir(&mc_version, loader)?
    } else {
        get_cache_dir_for_version(resource_kind, &mc_version)?
    };
    let src_path = src_dir.join(&file_name);
    if !src_path.exists() {
        return Err(format!("源文件不存在: {}", src_path.display()));
    }
    let dest_base = std::path::PathBuf::from(&instance_dir);
    let dest_dir = dest_base.join(&instance_subdir);
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let dest_path = dest_dir.join(&file_name);
    if dest_path.exists() {
        return Err(format!("目标文件已存在: {}", dest_path.display()));
    }
    let is_dir = src_path.is_dir();
    if is_dir {
        match std::fs::rename(&src_path, &dest_path) {
            Ok(_) => Ok(()),
            Err(_) => {
                copy_dir_recursive(&src_path, &dest_path)
                    .map_err(|e| format!("从 {} 复制目录到 {} 失败: {}", src_path.display(), dest_path.display(), e))?;
                std::fs::remove_dir_all(&src_path)
                    .map_err(|e| format!("删除源目录 {} 失败: {}", src_path.display(), e))?;
                Ok(())
            }
        }
    } else {
        match std::fs::rename(&src_path, &dest_path) {
            Ok(_) => Ok(()),
            Err(_) => {
                std::fs::copy(&src_path, &dest_path).map_err(|e2| {
                    format!("从 {} 复制到 {} 失败: {}", src_path.display(), dest_path.display(), e2)
                })?;
                std::fs::remove_file(&src_path).map_err(|e2| {
                    format!("删除源文件 {} 失败: {}", src_path.display(), e2)
                })?;
                Ok(())
            }
        }
    }
}
fn copy_dir_recursive(src: &std::path::Path, dest: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let entry_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if entry_path.is_dir() {
            copy_dir_recursive(&entry_path, &dest_path)?;
        } else {
            std::fs::copy(&entry_path, &dest_path)?;
        }
    }
    Ok(())
}
#[tauri::command]
pub fn instance_to_cache(
    kind: String,
    mc_version: String,
    mod_loader: Option<String>,
    file_name: String,
    instance_dir: String,
    instance_subdir: String,
) -> Result<(), String> {
    let resource_kind = parse_resource_kind(&kind)?;
    let src_dir = std::path::PathBuf::from(&instance_dir).join(&instance_subdir);
    let src_path = src_dir.join(&file_name);
    if !src_path.exists() {
        return Err(format!("源文件不存在: {}", src_path.display()));
    }
    let dest_dir = if resource_kind == CacheResourceKind::Mod {
        let loader_str = mod_loader.as_ref()
            .map(|s| s.as_str())
            .unwrap_or("forge");
        let loader = parse_mod_loader(loader_str)?;
        let dir = get_mod_cache_dir(&mc_version, loader)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        dir
    } else {
        let dir = get_cache_dir_for_version(resource_kind, &mc_version)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        dir
    };
    let dest_path = dest_dir.join(&file_name);
    if dest_path.exists() {
        return Err(format!("目标文件已存在: {}", dest_path.display()));
    }
    let is_dir = src_path.is_dir();
    if is_dir {
        match std::fs::rename(&src_path, &dest_path) {
            Ok(_) => Ok(()),
            Err(_) => {
                copy_dir_recursive(&src_path, &dest_path)
                    .map_err(|e| format!("从 {} 复制目录到 {} 失败: {}", src_path.display(), dest_path.display(), e))?;
                std::fs::remove_dir_all(&src_path)
                    .map_err(|e| format!("删除源目录 {} 失败: {}", src_path.display(), e))?;
                Ok(())
            }
        }
    } else {
        match std::fs::rename(&src_path, &dest_path) {
            Ok(_) => Ok(()),
            Err(_) => {
                std::fs::copy(&src_path, &dest_path).map_err(|e2| {
                    format!("从 {} 复制到 {} 失败: {}", src_path.display(), dest_path.display(), e2)
                })?;
                std::fs::remove_file(&src_path).map_err(|e2| {
                    format!("删除源文件 {} 失败: {}", src_path.display(), e2)
                })?;
                Ok(())
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_kind_dir_names() {
        assert_eq!(CacheResourceKind::Mod.dir_name(), "mods");
        assert_eq!(CacheResourceKind::ResourcePack.dir_name(), "resourcepacks");
        assert_eq!(CacheResourceKind::DataPack.dir_name(), "datapacks");
        assert_eq!(CacheResourceKind::World.dir_name(), "worlds");
        assert_eq!(CacheResourceKind::ShaderPack.dir_name(), "shaderpacks");
    }
    #[test]
    fn test_sanitize_version() {
        assert_eq!(sanitize_version("1.12.2"), "1.12.2");
        assert_eq!(sanitize_version("  1.20.4  "), "1.20.4");
        assert_eq!(sanitize_version(""), "unknown");
        assert_eq!(sanitize_version("1.12/forge"), "1.12_forge");
    }
    #[test]
    fn test_cache_root_dir_can_be_created() {
        let dir = cache_root_dir();
        assert!(dir.is_ok());
        assert!(dir.unwrap().exists());
    }
    #[test]
    fn test_mod_loader_dir_names() {
        assert_eq!(ModLoaderKind::Forge.dir_name(), "forge");
        assert_eq!(ModLoaderKind::NeoForge.dir_name(), "neoforge");
        assert_eq!(ModLoaderKind::Fabric.dir_name(), "fabric");
        assert_eq!(ModLoaderKind::Quilt.dir_name(), "quilt");
        assert_eq!(ModLoaderKind::LiteLoader.dir_name(), "liteloader");
        assert_eq!(ModLoaderKind::Ornithe.dir_name(), "ornithe");
        assert_eq!(ModLoaderKind::Vanilla.dir_name(), "vanilla");
        assert_eq!(ModLoaderKind::Custom("my_loader".to_string()).dir_name(), "my_loader");
    }
    #[test]
    fn test_parse_mod_loader_variants() {
        assert!(matches!(parse_mod_loader("forge"), Ok(ModLoaderKind::Forge)));
        assert!(matches!(parse_mod_loader("NEOFORGE"), Ok(ModLoaderKind::NeoForge)));
        assert!(matches!(parse_mod_loader("Fabric"), Ok(ModLoaderKind::Fabric)));
        assert!(matches!(parse_mod_loader("quilt"), Ok(ModLoaderKind::Quilt)));
        assert!(matches!(parse_mod_loader("liteloader"), Ok(ModLoaderKind::LiteLoader)));
        assert!(matches!(parse_mod_loader("ornithe"), Ok(ModLoaderKind::Ornithe)));
        assert!(matches!(parse_mod_loader(""), Ok(ModLoaderKind::Vanilla)));
        assert!(matches!(parse_mod_loader("通用"), Ok(ModLoaderKind::Vanilla)));
        assert!(matches!(parse_mod_loader("my_custom_loader"), Ok(ModLoaderKind::Custom(_))));
        assert!(matches!(parse_mod_loader("Rift"), Ok(ModLoaderKind::Custom(_))));
    }
    #[test]
    fn test_get_mod_cache_dir_creates_nested_structure() {
        let dir = get_mod_cache_dir("1.12.2", ModLoaderKind::Forge);
        assert!(dir.is_ok());
        let path = dir.unwrap();
        let path_str = path.to_string_lossy();
        assert!(path_str.contains("mods"));
        assert!(path_str.contains("1.12.2"));
        assert!(path_str.contains("forge"));
        assert!(path.exists());
    }
}