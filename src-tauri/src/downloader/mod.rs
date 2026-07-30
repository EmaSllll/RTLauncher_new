pub mod version_fetcher;
pub mod decompression;
pub mod original_dwl;
#[path = "dwpatch.rs"]
#[allow(non_snake_case)]
pub mod dwPatch;
pub mod optifine_installer;
pub mod fabric_installer;
pub mod quilt_installer;
#[allow(non_snake_case)]
pub mod mod_loader_installer;
pub mod concurrent_download;
pub mod modular_download;
pub mod mod_loader_installer_shared;
pub mod forge_installer;
#[allow(non_snake_case)]
pub mod neoforge_installer;
pub mod liteloader_installer;
#[allow(non_snake_case)]
pub mod modpack_installer;
pub mod shared_utils;
