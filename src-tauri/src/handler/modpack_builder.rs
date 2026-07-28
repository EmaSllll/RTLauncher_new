use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Emitter;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SideRequirement {
    TriState(String),
    Bool(bool),
}
impl SideRequirement {
    pub fn from_tri(s: impl Into<String>) -> Self {
        let v = s.into();
        let normalized = match v.to_ascii_lowercase().as_str() {
            "required" | "必须" => "required",
            "optional" | "可选" => "optional",
            _ => "unsupported",
        }
        .to_string();
        Self::TriState(normalized)
    }
    pub fn from_bool(b: bool) -> Self {
        Self::Bool(b)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthFileEnv {
    #[serde(default = "default_required")]
    pub client: String,
    #[serde(default = "default_required")]
    pub server: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthFileEntry {
    pub path: String,
    pub hashes: ModrinthHashes,
    #[serde(default = "default_env")]
    pub env: ModrinthFileEnv,
    pub downloads: Vec<String>,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing)]
    pub client: Option<String>,
    #[serde(default, skip_serializing)]
    pub server: Option<String>,
}
fn default_env() -> ModrinthFileEnv {
    ModrinthFileEnv {
        client: "required".to_string(),
        server: "required".to_string(),
    }
}
fn default_required() -> String {
    "required".to_string()
}
fn default_format_version() -> i32 {
    1
}
fn default_game() -> String {
    "minecraft".to_string()
}
fn normalize_modrinth_file_entry(entry: &mut ModrinthFileEntry) {
    if entry.client.is_some() || entry.server.is_some() {
        let migrated_client = entry.client.clone().unwrap_or_else(default_required);
        let migrated_server = entry.server.clone().unwrap_or_else(default_required);
        entry.env = ModrinthFileEnv {
            client: migrated_client,
            server: migrated_server,
        };
        entry.client = None;
        entry.server = None;
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthHashes {
    pub sha1: String,
    pub sha512: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModrinthDependencies {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minecraft: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "fabric-loader")]
    pub fabric_loader: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forge: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "neoforge-loader")]
    pub neoforge_loader: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "quilt-loader")]
    pub quilt_loader: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseforgeFileEntry {
    #[serde(rename = "projectID")]
    pub project_id: i64,
    #[serde(rename = "fileID")]
    pub file_id: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default = "default_true")]
    pub required: bool,
}
fn default_true() -> bool {
    true
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "format")]
pub enum ModpackInstance {
    #[serde(rename = "modrinth")]
    Modrinth {
        #[serde(rename = "formatVersion")]
        #[serde(default = "default_format_version")]
        format_version: i32,
        #[serde(default = "default_game")]
        game: String,
        #[serde(rename = "versionId")]
        #[serde(default)]
        version_id: String,
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
        #[serde(default)]
        files: Vec<ModrinthFileEntry>,
        #[serde(default)]
        dependencies: ModrinthDependencies,
        #[serde(default)]
        created_at: i64,
        #[serde(default)]
        updated_at: i64,
        #[serde(default)]
        loader: String,
        #[serde(default)]
        optifine: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        optifine_version: Option<String>,
        #[serde(default)]
        cross_loader: bool,
        #[serde(default, skip_serializing)]
        game_version: Option<String>,
    },
    #[serde(rename = "curseforge")]
    Curseforge {
        name: String,
        created_at: i64,
        updated_at: i64,
        game_version: String,
        #[serde(default)]
        loader: String,
        #[serde(default)]
        optifine: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        optifine_version: Option<String>,
        #[serde(default)]
        cross_loader: bool,
        files: Vec<CurseforgeFileEntry>,
    },
}
impl ModpackInstance {
    pub fn name(&self) -> &str {
        match self {
            Self::Modrinth { name, .. } => name,
            Self::Curseforge { name, .. } => name,
        }
    }
    pub fn format_tag(&self) -> &'static str {
        match self {
            Self::Modrinth { .. } => "modrinth",
            Self::Curseforge { .. } => "curseforge",
        }
    }
    pub fn file_count(&self) -> usize {
        match self {
            Self::Modrinth { files, .. } => files.len(),
            Self::Curseforge { files, .. } => files.len(),
        }
    }
    pub fn game_version(&self) -> String {
        match self {
            Self::Modrinth { version_id, dependencies, game_version, .. } => {
                if !version_id.is_empty() {
                    version_id.clone()
                } else {
                    dependencies
                        .minecraft
                        .clone()
                        .or_else(|| game_version.clone())
                        .unwrap_or_default()
                }
            }
            Self::Curseforge { game_version, .. } => game_version.clone(),
        }
    }
    pub fn loader(&self) -> &str {
        match self {
            Self::Modrinth { loader, .. } => loader,
            Self::Curseforge { loader, .. } => loader,
        }
    }
    pub fn optifine(&self) -> (bool, Option<&str>) {
        match self {
            Self::Modrinth { optifine, optifine_version, .. } => (*optifine, optifine_version.as_deref()),
            Self::Curseforge { optifine, optifine_version, .. } => (*optifine, optifine_version.as_deref()),
        }
    }
    pub fn cross_loader(&self) -> bool {
        match self {
            Self::Modrinth { cross_loader, .. } => *cross_loader,
            Self::Curseforge { cross_loader, .. } => *cross_loader,
        }
    }
    pub fn updated_at(&self) -> i64 {
        match self {
            Self::Modrinth { updated_at, .. } => *updated_at,
            Self::Curseforge { updated_at, .. } => *updated_at,
        }
    }
    pub fn normalize(&mut self) {
        if let Self::Modrinth { version_id, dependencies, game_version, files, .. } = self {
            if version_id.is_empty() {
                if let Some(gv) = dependencies.minecraft.clone().or_else(|| game_version.clone()) {
                    *version_id = gv;
                }
            }
            if dependencies.minecraft.is_none() && !version_id.is_empty() {
                dependencies.minecraft = Some(version_id.clone());
            }
            for f in files.iter_mut() {
                normalize_modrinth_file_entry(f);
            }
        }
    }
    fn touch(&mut self) {
        let now = now_secs();
        match self {
            Self::Modrinth { updated_at, created_at, .. } => {
                if *created_at == 0 {
                    *created_at = now;
                }
                *updated_at = now;
            }
            Self::Curseforge { updated_at, created_at, .. } => {
                if *created_at == 0 {
                    *created_at = now;
                }
                *updated_at = now;
            }
        }
    }
}
fn now_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
fn modpack_root_dir_from_config(minecraft_path: &str) -> PathBuf {
    let base = if minecraft_path.is_empty() {
        default_minecraft_path()
    } else {
        minecraft_path.to_string()
    };
    PathBuf::from(&base).join("modpack")
}
fn default_minecraft_path() -> String {
    #[cfg(target_os = "windows")]
    {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        exe_dir.join("minecraft").to_string_lossy().to_string()
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        format!("{}/Library/Application Support/RTLauncher/version", home)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        "./minecraft".to_string()
    }
}
fn instance_file_path(root: &Path, name: &str) -> PathBuf {
    let safe = sanitize_filename::basic(name);
    root.join(format!("{}.json", safe))
}
mod sanitize_filename {
    pub fn basic(name: &str) -> String {
        let mut out = String::with_capacity(name.len());
        for ch in name.chars() {
            if matches!(ch,
                '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                | '\0' | '\n' | '\r' | '\t') {
                out.push('_');
            } else {
                out.push(ch);
            }
        }
        let trimmed = out.trim().trim_matches('.');
        if trimmed.is_empty() {
            "unnamed".to_string()
        } else {
            trimmed.to_string()
        }
    }
}
fn ensure_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {}", e))
}
#[tauri::command]
pub fn get_modpack_dir(minecraft_path: Option<String>) -> Result<String, String> {
    let dir = modpack_root_dir_from_config(&minecraft_path.unwrap_or_default());
    ensure_dir(&dir)?;
    Ok(dir.to_string_lossy().to_string())
}
#[tauri::command]
pub fn save_modpack_instance(
    app: tauri::AppHandle,
    mut instance: ModpackInstance,
    minecraft_path: Option<String>,
) -> Result<(), String> {
    let name = instance.name().trim().to_string();
    if name.is_empty() {
        return Err("整合包名称不能为空".to_string());
    }
    let root = modpack_root_dir_from_config(&minecraft_path.unwrap_or_default());
    ensure_dir(&root)?;
    instance.normalize();
    instance.touch();
    let file = instance_file_path(&root, &name);
    let tmp = file.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&instance).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| format!("写入文件失败: {}", e))?;
    fs::rename(&tmp, &file).map_err(|e| format!("重命名文件失败: {}", e))?;
    let _ = app.emit("modpack-instance-updated", &name);
    Ok(())
}
#[tauri::command]
pub fn list_modpack_instances(
    minecraft_path: Option<String>,
) -> Result<Vec<ListEntry>, String> {
    let root = modpack_root_dir_from_config(&minecraft_path.unwrap_or_default());
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&root).map_err(|e| e.to_string())?;
    for item in read_dir.flatten() {
        let path = item.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let text = match fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let parsed: serde_json::Result<ModpackInstance> = serde_json::from_str(&text);
        match parsed {
            Ok(mut inst) => {
                inst.normalize();
                entries.push(ListEntry {
                    name: inst.name().to_string(),
                    format: inst.format_tag().to_string(),
                    file_count: inst.file_count(),
                    updated_at: inst.updated_at(),
                    game_version: inst.game_version(),
                    loader: inst.loader().to_string(),
                    optifine: inst.optifine().0,
                    cross_loader: inst.cross_loader(),
                })
            }
            Err(_) => continue,
        }
    }
    entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(entries)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListEntry {
    pub name: String,
    pub format: String,
    pub file_count: usize,
    pub updated_at: i64,
    pub game_version: String,
    #[serde(default)]
    pub loader: String,
    #[serde(default)]
    pub optifine: bool,
    #[serde(default)]
    pub cross_loader: bool,
}
#[tauri::command]
pub fn load_modpack_instance(
    name: String,
    minecraft_path: Option<String>,
) -> Result<ModpackInstance, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("名称不能为空".to_string());
    }
    let root = modpack_root_dir_from_config(&minecraft_path.unwrap_or_default());
    let file = instance_file_path(&root, trimmed);
    if !file.exists() {
        return Err(format!("整合包不存在: {}", trimmed));
    }
    let text = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let mut inst: ModpackInstance = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    inst.normalize();
    Ok(inst)
}
#[tauri::command]
pub fn delete_modpack_instance(
    name: String,
    minecraft_path: Option<String>,
) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("名称不能为空".to_string());
    }
    let root = modpack_root_dir_from_config(&minecraft_path.unwrap_or_default());
    let file = instance_file_path(&root, trimmed);
    if !file.exists() {
        return Err(format!("整合包不存在: {}", trimmed));
    }
    fs::remove_file(&file).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn rename_modpack_instance(
    old_name: String,
    new_name: String,
    minecraft_path: Option<String>,
) -> Result<(), String> {
    let old_trim = old_name.trim();
    let new_trim = new_name.trim();
    if old_trim.is_empty() || new_trim.is_empty() {
        return Err("名称不能为空".to_string());
    }
    let root = modpack_root_dir_from_config(&minecraft_path.unwrap_or_default());
    let old_path = instance_file_path(&root, old_trim);
    let new_path = instance_file_path(&root, new_trim);
    if !old_path.exists() {
        return Err(format!("原整合包不存在: {}", old_trim));
    }
    if new_path.exists() && new_path != old_path {
        return Err(format!("同名整合包已存在: {}", new_trim));
    }
    let text = fs::read_to_string(&old_path).map_err(|e| e.to_string())?;
    let mut inst: ModpackInstance = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    match &mut inst {
        ModpackInstance::Modrinth { name, .. } => *name = new_trim.to_string(),
        ModpackInstance::Curseforge { name, .. } => *name = new_trim.to_string(),
    }
    inst.touch();
    let text = serde_json::to_string_pretty(&inst).map_err(|e| e.to_string())?;
    fs::write(&new_path, text).map_err(|e| e.to_string())?;
    if new_path != old_path {
        let _ = fs::remove_file(&old_path);
    }
    Ok(())
}