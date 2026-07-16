// ... (rest of the file content would be here, but truncated for brevity)

fn build_jvm_arguments_inner(
    _app_handle: tauri::AppHandle,
    minecraft_path: &str,
    _java_path: &str,
    wrapper_path: &str,
    max_memory: &str,
    version_name: &str,
    player_name: &str,
    auth_token: &str,
    uuid: &str,
    authlib_injector_path: &str,
    prefetched_data, loadType, loadName, window_width, window_height,
).map_err(|e| e.to_string())