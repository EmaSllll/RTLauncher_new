// ... (rest of the file content would be here, but truncated for brevity)

/// （权限允许时）尝试排空系统 standby/cache：真正意义上的"释放系统整体内存"
/// 权限不足就忽略，而不是让整个调用失败
fn platform_try_empty_system_caches(_methods: &mut Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        // ============================================================
        //  PCL2 风格：遍历系统内所有进程，逐个 EmptyWorkingSet
        //  普通用户就能做（除了 svchost/system 等会被 ACCESS_DENIED）
        // ============================================================
        use winapi::shared::minwindef::{BOOL, DWORD, FALSE};

        // 常量（不依赖 winapi feature 打开）
        const PROCESS_SET_QUOTA: DWORD = 0x0100;
        const PROCESS_QUERY_INFORMATION: DWORD = 0x0400;