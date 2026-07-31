mod auth;
mod app_paths;
mod handler;
mod downloader;
mod mutiplayer;
mod version_management;
mod http_client;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
use objc2::msg_send;
#[cfg(target_os = "macos")]
use objc2::runtime::AnyObject;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSColor, NSWindow};
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;

#[cfg(target_os = "macos")]
const NS_WINDOW_TITLE_HIDDEN: i64 = 1;
#[cfg(target_os = "macos")]
const NS_WINDOW_STYLE_MASK_FULL_SIZE_CONTENT_VIEW: u64 = 1 << 15;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cpu_count = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(4);
    let worker_threads = (cpu_count + 1).saturating_div(2).max(4);
    std::env::set_var("TOKIO_WORKER_THREADS", worker_threads.to_string());

    use handler::launcher::{build_jvm_arguments, launch_game, kill_game_process};
    use handler::system::{get_system_memory, write_file, optimize_memory_usage, open_external, read_file_base64};
    use handler::config::{get_launcher_paths_config, save_launcher_paths_config, get_java_download_dir};
    use handler::java_downloader::{get_java_versions, download_java_runtime};
    use handler::java_scanner::{search_java_installations, validate_java_path};

    use handler::optifine_handler::{get_optifine_versions, get_optifine_version_names, install_optifine, download_and_install_optifine, cancel_optifine_download};
    use handler::fabric_handler::{get_fabric_loader_versions, get_fabric_api_versions, download_and_install_fabric, cancel_fabric_download};
    use handler::quilt_handler::{get_quilt_loader_versions, get_quilt_api_versions, download_and_install_quilt, cancel_quilt_download};
    use handler::forge_handler::{get_forge_versions, download_and_install_forge, cancel_forge_download};
    use handler::neoforge_handler::{get_neoforge_versions, download_and_install_neoforge, cancel_neoforge_download};
    use handler::liteloader_handler::{get_liteloader_versions, download_and_install_liteloader, cancel_liteloader_download};
    use handler::chinese_search::{search_moddata, get_moddata_info};
    use handler::mod_links::{
        get_mod_links, get_curseforge_mod_files, get_curseforge_required_dependencies,
        get_mod_files_by_slug, get_modrinth_mod_files, get_modrinth_project,
        get_modrinth_required_dependencies, download_mod_file, download_resource_file,
        cancel_mod_download, search_curseforge_projects, search_modrinth_projects,
    };
    use handler::modpack_builder::{
        get_modpack_dir, save_modpack_instance, list_modpack_instances,
        load_modpack_instance, delete_modpack_instance, rename_modpack_instance,
    };
    use handler::modpack_installer_handler::{
        detect_modpack_format_cmd, install_modpack_from_zip_cmd, cancel_modpack_install,
        parse_modpack_cmd, save_modpack_to_cache_cmd, list_cached_modpacks_cmd,
        delete_cached_modpack_cmd, delete_version_dir_cmd,
    };
    use handler::cache_paths::{
        get_cache_root, get_cache_dir, get_cache_dir_by_version,
        init_cache_dirs, list_cache_dirs, list_cached_files,
        get_mod_cache_dir_cmd, list_cached_mods,
        cache_to_instance, instance_to_cache,
    };
    use handler::mod_parser::{parse_mod, parse_mods, parse_mods_in_dir, save_incompatible_mods};

    use downloader::dwPatch::{download_patcher, cancel_download};
    use downloader::version_fetcher::classify_minecraft_versions;
    use downloader::decompression::extract_library_paths;

    use auth::littleskinLoader::{useMethod, use_method_with_credentials};
    use auth::yissadrail::{thirdPartyLogin, getAccountList, getPlayerSkin};
    use auth::official::{
        ms_request_device_code, ms_poll_and_login, ms_cancel_login,
        get_skin_base64, redownload_littleskin_skin,
        ms_get_skins_and_capes, ms_upload_skin,
        ms_activate_skin, ms_delete_skin, ms_set_active_cape,
    };

    use mutiplayer::{
        mp_check_openp2p, mp_install_openp2p, mp_start_openp2p_host,
        mp_start_openp2p_join, mp_encode_room_info, mp_stop_openp2p,
        mp_is_openp2p_running, mp_poll_log, mp_get_openp2p_dir,
        mp_get_openp2p_path, ensure_openp2p_stopped,
    };

    use version_management::{
        vm_scan_instances, vm_find_resource_packs, vm_parse_level_dat,
        vm_modify_game_rule, vm_list_dir, vm_ensure_instance_dirs,
        vm_delete_file, vm_rename_file, vm_write_file_base64,
        vm_delete_cached_file,
    };

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            // --- 启动 / Launch ---
            build_jvm_arguments, launch_game, kill_game_process,
            // --- 下载 / Download ---
            download_patcher, cancel_download,
            classify_minecraft_versions, extract_library_paths,
            // --- 认证 / Auth ---
            useMethod, use_method_with_credentials,
            thirdPartyLogin, getAccountList, getPlayerSkin,
            ms_request_device_code, ms_poll_and_login, ms_cancel_login,
            get_skin_base64, redownload_littleskin_skin,
            ms_get_skins_and_capes, ms_upload_skin,
            ms_activate_skin, ms_delete_skin, ms_set_active_cape,
            // --- 多人联机 / Multiplayer ---
            mp_check_openp2p, mp_install_openp2p,
            mp_start_openp2p_host, mp_start_openp2p_join,
            mp_encode_room_info, mp_stop_openp2p,
            mp_is_openp2p_running, mp_poll_log,
            mp_get_openp2p_dir, mp_get_openp2p_path,
            // --- 版本管理 / Version Management ---
            vm_scan_instances, vm_find_resource_packs,
            vm_parse_level_dat, vm_modify_game_rule,
            vm_list_dir, vm_ensure_instance_dirs,
            vm_delete_file, vm_rename_file,
            vm_write_file_base64, vm_delete_cached_file,
            // --- 系统 / System ---
            get_system_memory, optimize_memory_usage,
            open_external, read_file_base64, write_file,
            get_launcher_paths_config, save_launcher_paths_config,
            get_java_download_dir,
            get_java_versions, download_java_runtime,
            search_java_installations, validate_java_path,
            // --- Mod 加载器 / Mod Loaders ---
            get_optifine_versions, get_optifine_version_names,
            install_optifine, download_and_install_optifine,
            cancel_optifine_download,
            get_fabric_loader_versions, get_fabric_api_versions,
            download_and_install_fabric, cancel_fabric_download,
            get_quilt_loader_versions, get_quilt_api_versions,
            download_and_install_quilt, cancel_quilt_download,
            get_forge_versions, download_and_install_forge, cancel_forge_download,
            get_neoforge_versions, download_and_install_neoforge, cancel_neoforge_download,
            get_liteloader_versions, download_and_install_liteloader,
            cancel_liteloader_download,
            // --- Mod 搜索 / Mod Search ---
            search_moddata, get_moddata_info,
            get_mod_links,
            get_curseforge_mod_files, get_curseforge_required_dependencies,
            get_mod_files_by_slug, get_modrinth_mod_files,
            get_modrinth_project, get_modrinth_required_dependencies,
            search_curseforge_projects, search_modrinth_projects,
            download_mod_file, download_resource_file, cancel_mod_download,
            // --- 整合包 / Modpack ---
            get_modpack_dir, save_modpack_instance,
            list_modpack_instances, load_modpack_instance,
            delete_modpack_instance, rename_modpack_instance,
            detect_modpack_format_cmd, install_modpack_from_zip_cmd,
            cancel_modpack_install, parse_modpack_cmd,
            save_modpack_to_cache_cmd, list_cached_modpacks_cmd,
            delete_cached_modpack_cmd, delete_version_dir_cmd,
            // --- 缓存 / Cache ---
            get_cache_root, get_cache_dir, get_cache_dir_by_version,
            init_cache_dirs, list_cache_dirs, list_cached_files,
            get_mod_cache_dir_cmd, list_cached_mods,
            cache_to_instance, instance_to_cache,
            // --- Mod 解析 / Mod Parser ---
            parse_mod, parse_mods, parse_mods_in_dir, save_incompatible_mods,
        ])
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(not(target_os = "macos"))]
            app.handle().plugin(tauri_plugin_single_instance::init(|app: &tauri::AppHandle, _args, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }))?;
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(if cfg!(debug_assertions) {
                        log::LevelFilter::Debug
                    } else {
                        log::LevelFilter::Info
                    })
                    .targets(if cfg!(debug_assertions) {
                        vec![
                            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
                        ]
                    } else {
                        vec![
                            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
                        ]
                    })
                    .build(),
            )?;

            let window = if let Some(window) = app.get_webview_window("main") {
                window
            } else {
                let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                    .title("RTLauncher")
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(1024.0, 640.0)
                    .center()
                    .resizable(true)
                    .fullscreen(false)
                    .shadow(true);

                #[cfg(target_os = "macos")]
                let win_builder = win_builder.title_bar_style(TitleBarStyle::Transparent);

                #[cfg(not(target_os = "macos"))]
                let win_builder = win_builder.decorations(false);

                win_builder.build()?
            };

            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    #[cfg(target_os = "windows")]
                    {
                        use std::os::windows::process::CommandExt;
                        use winapi::um::winbase::CREATE_NO_WINDOW;
                        let _ = std::process::Command::new("taskkill")
                            .args(["/F", "/T", "/IM", "openp2p.exe"])
                            .creation_flags(CREATE_NO_WINDOW)
                            .output();
                        let _ = std::process::Command::new("taskkill")
                            .args(["/F", "/T", "/IM", "openp2p"])
                            .creation_flags(CREATE_NO_WINDOW)
                            .output();
                        let _ = std::process::Command::new("wmic")
                            .args(["process", "where", "name='openp2p.exe'", "delete"])
                            .creation_flags(CREATE_NO_WINDOW)
                            .output();
                    }
                    #[cfg(any(target_os = "linux", target_os = "macos"))]
                    {
                        let _ = std::process::Command::new("killall")
                            .args(["-9", "openp2p"])
                            .output();
                        let _ = std::process::Command::new("pkill")
                            .args(["-9", "-f", "openp2p"])
                            .output();
                    }
                }
            });

            #[cfg(not(target_os = "macos"))]
            let _ = &window;

            #[cfg(target_os = "macos")]
            unsafe {
                let ns_window_ptr = window.ns_window().unwrap() as *mut AnyObject;
                let ns_window = &*(ns_window_ptr as *const NSWindow);

                let () = msg_send![ns_window_ptr, setTitlebarAppearsTransparent: true];
                let () = msg_send![ns_window_ptr, setTitleVisibility: NS_WINDOW_TITLE_HIDDEN];

                let style_mask: u64 = msg_send![ns_window_ptr, styleMask];
                let style_mask = style_mask | NS_WINDOW_STYLE_MASK_FULL_SIZE_CONTENT_VIEW;
                let () = msg_send![ns_window_ptr, setStyleMask: style_mask];
                let () = msg_send![ns_window_ptr, setMovableByWindowBackground: false];

                let bg_color = NSColor::colorWithSRGBRed_green_blue_alpha(0.0, 0.0, 0.0, 0.0);
                ns_window.setBackgroundColor(Some(&bg_color));
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    ensure_openp2p_stopped();
}
