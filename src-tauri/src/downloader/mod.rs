pub mod version_fetcher;
pub mod decompression;
pub mod original_dwl;
// 仓库历史上同时存在 dwPatch.rs 与 dwpatch.rs；显式绑定小写文件，
// 避免大小写敏感的 Linux/macOS 与 Windows 解析到不同实现。
#[path = "dwpatch.rs"]
#[allow(non_snake_case)]
pub mod dwPatch;
pub mod optifine_installer;
pub mod fabric_installer;
pub mod quilt_installer;
pub mod mod_loader_installer;
pub mod concurrent_download;
pub mod modular_download;
pub mod mod_loader_installer_shared;
pub mod forge_installer;
pub mod neoforge_installer;
pub mod liteloader_installer;
pub mod modpack_installer;
pub mod shared_utils;
