use serde::Serialize;
use sysinfo::System;
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};
use base64::{self, Engine};

#[derive(Serialize)]
pub struct MemoryInfo {
    /// 系统物理总内存（MB）
    pub total_mb: u64,
    /// 已使用内存（MB）
    pub used_mb: u64,
    /// 当前可用内存（MB，即 total - used）
    pub available_mb: u64,
    /// 推荐自动分配给游戏的内存（MB，取可用内存的 80%）
    pub recommended_mb: u64,
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    webbrowser::open(&url).map_err(|e| format!("Failed to open URL: {}", e))
}

#[tauri::command]
pub fn read_file_base64(path: String) -> Result<String, String> {
    let content = fs::read(&path)
        .map_err(|e| format!("读取文件失败: {}", e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&content))
}

#[tauri::command]
pub fn get_system_memory() -> MemoryInfo {
    let mut sys = System::new();
    sys.refresh_memory();

    let total_mb = sys.total_memory() / 1024 / 1024;
    let used_mb = sys.used_memory() / 1024 / 1024;

    // macOS 上 sysinfo 的 available_memory() 有时报告偏小，
    // 因为 macOS 的 memory/compressed 模型不会把 inactive + compressed
    // 全部视为"可用"。这里取 total - used 作为保守估计。
    let available_mb = total_mb.saturating_sub(used_mb);

    // 推荐分配：可用内存的 80%，同时设置合理上下限
    //  - 至少 512 MB，最多总内存的 90%
    let raw_recommended = (available_mb as f64 * 0.8) as u64;
    let upper_bound = (total_mb as f64 * 0.9) as u64;
    let recommended_mb = raw_recommended
        .min(upper_bound)
        .max(512);
    MemoryInfo {
        total_mb,
        used_mb,
        available_mb,
        recommended_mb,
    }
}

/// 写入文件
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let file_path = Path::new(&path);

    // 确保父目录存在
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    // 写入文件
    fs::write(file_path, content).map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// 跨平台内存清理
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct MemoryOptimizationReport {
    /// 清理前可用内存（MB）
    pub available_before_mb: u64,
    /// 清理后可用内存（MB）
    pub available_after_mb: u64,
    /// 差值（约等于释放的内存 MB，粗略值）
    pub freed_mb: i64,
    /// 系统总内存（MB）
    pub total_mb: u64,
    /// 当前平台标识
    pub platform: String,
    /// 本次实际用到的清理手段（用于前端显示/调试）
    pub methods: Vec<String>,
    /// 清理耗时（ms）
    pub duration_ms: u64,
}

/// 主入口：一键优化系统内存
///
/// 实现思路：
///   - 调用平台专属的系统 API 收缩文件缓存 + 当前进程工作集
///   - 尝试释放 standby/cache（如权限不足则忽略）
///   - 最后做一轮"内存抖动"：分配系统可用内存的一部分，touch 它，然后释放它，
///     以迫使操作系统把 standby/cache 里的陈旧数据让出来给其他应用
#[tauri::command]
pub fn optimize_memory_usage() -> Result<MemoryOptimizationReport, String> {
    let start = std::time::Instant::now();
    let mut methods: Vec<String> = Vec::new();
    let mut sys = System::new();

    // 1. 读取清理前的内存状态
    sys.refresh_memory();
    let total_kb = sys.total_memory();

    // macOS 上 sysinfo 的 available_memory() 报告值偏小（不包含 compressed/inactive），
    // 这里使用 total - used 作为保守估计，与 get_system_memory 保持一致。
    #[cfg(target_os = "macos")]
    let available_before_kb = total_kb.saturating_sub(sys.used_memory());
    #[cfg(not(target_os = "macos"))]
    let available_before_kb = sys.available_memory();

    // 2. 平台专属清理
    platform_trim_current_process(&mut methods);
    platform_drop_file_caches(&mut methods);
    platform_try_empty_system_caches(&mut methods);

    // 3. 内存抖动：分配一块中等大小内存，强制页面提交/入页，随后释放
    let jitter_bytes = platform_memory_jitter_size_bytes();
    if jitter_bytes > 0 {
        memory_jitter(jitter_bytes);
        methods.push(format!(
            "memory_jitter({}MB)",
            jitter_bytes / 1024 / 1024
        ));
    }

    // 给系统一点时间来反映真实的可用内存
    std::thread::sleep(Duration::from_millis(80));

    // 4. 再次读取内存状态
    sys.refresh_memory();
    #[cfg(target_os = "macos")]
    let available_after_kb = total_kb.saturating_sub(sys.used_memory());
    #[cfg(not(target_os = "macos"))]
    let available_after_kb = sys.available_memory();

    let total_mb = total_kb / 1024 / 1024;
    let before_mb = available_before_kb / 1024 / 1024;
    let after_mb = available_after_kb / 1024 / 1024;
    let freed_mb = after_mb as i64 - before_mb as i64;
    let duration_ms = start.elapsed().as_millis() as u64;

    #[cfg(target_os = "windows")]
    let platform = "windows".to_string();
    #[cfg(target_os = "linux")]
    let platform = "linux".to_string();
    #[cfg(target_os = "macos")]
    let platform = "macos".to_string();
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    let platform = "other".to_string();

    Ok(MemoryOptimizationReport {
        available_before_mb: before_mb,
        available_after_mb: after_mb,
        freed_mb,
        total_mb,
        platform,
        methods,
        duration_ms,
    })
}

// ---------------------------------------------------------------------------
// 跨平台实现
// ---------------------------------------------------------------------------

/// 让当前进程把不必要的内存页还给操作系统
fn platform_trim_current_process(methods: &mut Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        // SetProcessWorkingSetSize(hProcess, -1, -1) + EmptyWorkingSet(hProcess)
        // 收缩本进程的物理工作集。然后会在 platform_try_empty_system_caches
        // 里遍历所有进程再做一次。
        use winapi::um::processthreadsapi::GetCurrentProcess;
        use winapi::shared::minwindef::BOOL;
        extern "system" {
            fn SetProcessWorkingSetSize(
                hProcess: *mut winapi::ctypes::c_void,
                dwMinimumWorkingSetSize: usize,
                dwMaximumWorkingSetSize: usize,
            ) -> BOOL;
            fn EmptyWorkingSet(hProcess: *mut winapi::ctypes::c_void) -> BOOL;
        }
        unsafe {
            let handle = GetCurrentProcess();
            if SetProcessWorkingSetSize(handle, usize::MAX, usize::MAX) != 0 {
                methods.push("windows.working_set(self)".to_string());
            }
            let _ = EmptyWorkingSet(handle);
        }
    }

    #[cfg(target_os = "linux")]
    {
        // malloc_trim(0) 让 glibc 释放顶部分配区周围未用的内存
        extern "C" {
            fn malloc_trim(pad: usize) -> i32;
        }
        unsafe {
            if malloc_trim(0) == 1 {
                methods.push("linux.malloc_trim".to_string());
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // macOS 上主动告诉系统可以丢弃我们的冷内存页：
        //   1) malloc_zone_pressure_relief(NULL, 0)：让 malloc 主动收缩各 zone
        //   2) posix_madvise(DONTNEED)：扫描 /proc/self/maps 上的文件映射并告诉内核可回收
        let mut any_ok = false;

        extern "C" {
            fn malloc_zone_pressure_relief(
                zone: *mut libc::c_void,
                goal: usize,
            ) -> usize;
            fn malloc_zone_for_each(
                callback: extern "C" fn(
                    zone: *mut libc::c_void,
                    info: *mut libc::c_void,
                    u: *mut libc::c_void,
                ),
            );
        }

        unsafe {
            let n = malloc_zone_pressure_relief(std::ptr::null_mut(), 0);
            if n > 0 { any_ok = true; }
        }

        // 通过 task / vm region 枚举当前进程的内存映射，对文件映射调用
        // posix_madvise(DONTNEED) 让内核释放文件缓存页。
        // 注意：旧的 `vm_region` 在较新的 macOS SDK 中已不再导出，必须使用
        // `vm_region_64` 配合 64 位 flavor，否则链接会报 "_vm_region" 未定义。
        unsafe {
            use libc::{c_int, mach_port_t, task_t};
            use std::ptr;

            extern "C" {
                fn mach_task_self() -> mach_port_t;
                fn vm_region_64(
                    target_task: task_t,
                    address: *mut u64,
                    size: *mut u64,
                    flavor: c_int,
                    info: *mut u8,
                    count: *mut c_int,
                    object_name: *mut mach_port_t,
                ) -> c_int;
                fn mach_port_deallocate(task: task_t, name: mach_port_t) -> c_int;
            }

            const VM_REGION_BASIC_INFO_64: c_int = 9;
            const SM_COW: c_int = 77;       // shared memory flag value
            const MACH_PORT_NULL: mach_port_t = 0;

            #[repr(C)]
            #[derive(Default)]
            struct VmRegionBasicInfo64 {
                protection: i32,
                max_protection: i32,
                inheritance: c_int,
                shared: c_int,
                reserved: c_int,
                offset: u64,
                behavior: c_int,
                user_wired_count: u16,
            }

            let task = mach_task_self();
            let mut addr: u64 = 0;
            let mut size: u64 = 0;
            let mut info: VmRegionBasicInfo64 = std::mem::zeroed();
            let mut count: c_int = (std::mem::size_of::<VmRegionBasicInfo64>() / 4) as c_int;
            let mut object: mach_port_t = MACH_PORT_NULL;

            loop {
                let kr = vm_region_64(
                    task, &mut addr, &mut size, VM_REGION_BASIC_INFO_64,
                    &mut info as *mut _ as *mut u8, &mut count, &mut object,
                );
                if kr != 0 { break; }
                if object != MACH_PORT_NULL {
                    mach_port_deallocate(task, object);
                    object = MACH_PORT_NULL;
                }

                // 对文件-backed 映射（non-zero offset 或 shared 的区域）调用 madvise
                if info.offset != 0 || info.shared == SM_COW {
                    let p = addr as *mut libc::c_void;
                    let s = size as libc::size_t;
                    // POSIX_MADV_DONTNEED = 4（macOS 定义）
                    libc::posix_madvise(p, s, 4);
                }

                addr = addr.checked_add(size).unwrap_or(0);
                if addr == 0 { break; }
            }
            any_ok = true;
        }

        if any_ok {
            methods.push("macos.trim_regions".to_string());
        }
    }
}

/// 让系统收缩文件缓存（不需要管理员权限，效果温和但完全无副作用）
fn platform_drop_file_caches(methods: &mut Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        // SetSystemFileCacheSize(0, SIZE_MAX, 0) 让系统把工作集上限设为无限，
        // 同时会触发一次 cache 收缩。
        use winapi::shared::minwindef::BOOL;
        extern "system" {
            fn SetSystemFileCacheSize(
                minimum_file_cache_size: usize,
                maximum_file_cache_size: usize,
                flags: u32,
            ) -> BOOL;
        }
        unsafe {
            // 0 / SIZE_MAX 是"让系统管理"的语义，不会丢数据
            if SetSystemFileCacheSize(0, usize::MAX, 0) != 0 {
                methods.push("windows.file_cache_trim".to_string());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // 先 sync 让脏页写回（无害），然后尝试 drop_caches
        use std::fs::OpenOptions;
        use std::io::Write;

        unsafe { libc::sync() };
        methods.push("linux.sync".to_string());

        if let Ok(mut f) = OpenOptions::new()
            .write(true)
            .open("/proc/sys/vm/drop_caches")
        {
            if f.write_all(b"3\n").is_ok() {
                methods.push("linux.drop_caches(pagecache+dentries)".to_string());
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // macOS 的 `purge` 需要 sudo，普通应用无法直接执行。
        // 我们用以下手段来释放文件缓存（均不需要权限）：
        //   1) sync()：让所有脏页写回磁盘
        //   2) 枚举已挂载的文件系统，对其 fd 调用 fcntl(F_NOCACHE)
        //      （温和地让内核不要保留这些文件缓存）
        //   3) 尝试通过 Apple 提供的"内存 pressure"机制释放非活跃内存
        unsafe {
            libc::sync();
            methods.push("macos.sync".to_string());
        }

        // 枚举 /tmp 和系统临时文件，对它们 open 后用 fcntl 设 F_NOCACHE
        // F_NOCACHE = 48 (macOS)：告诉内核不要把该 fd 的读写缓存保留
        const F_NOCACHE: i32 = 48;
        let targets = [
            "/var/db",
            "/tmp",
            "/private/tmp",
            "/System/Library/Caches",
        ];
        let mut triggered = 0usize;
        for t in targets.iter() {
            if let Ok(entries) = std::fs::read_dir(t) {
                for entry in entries.flatten() {
                    if triggered >= 64 { break; }
                    let path = entry.path();
                    if path.is_file() {
                        let raw = std::ffi::CString::new(path.to_string_lossy().as_bytes());
                        if let Ok(c_path) = raw {
                            let fd = unsafe { libc::open(c_path.as_ptr(), libc::O_RDONLY) };
                            if fd >= 0 {
                                unsafe { libc::fcntl(fd, F_NOCACHE, 1); }
                                unsafe { libc::close(fd); }
                                triggered += 1;
                            }
                        }
                    }
                }
            }
        }
        if triggered > 0 {
            methods.push(format!("macos.f_nocache({} files)", triggered));
        }
    }
}

/// （权限允许时）尝试排空系统 standby/cache：真正意义上的"释放系统整体内存"
/// 权限不足就忽略，而不是让整个调用失败
fn platform_try_empty_system_caches(methods: &mut Vec<String>) {
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
        const PROCESS_VM_READ: DWORD = 0x0010;

        // 全部自己 extern 声明，避免依赖 winapi feature
        extern "system" {
            fn EnumProcesses(
                lpidProcess: *mut DWORD,
                cb: DWORD,
                lpcbNeeded: *mut DWORD,
            ) -> BOOL;
            fn OpenProcess(
                dwDesiredAccess: DWORD,
                bInheritHandle: BOOL,
                dwProcessId: DWORD,
            ) -> *mut winapi::ctypes::c_void;
            fn GetCurrentProcessId() -> DWORD;
            fn CloseHandle(hObject: *mut winapi::ctypes::c_void) -> BOOL;
            fn EmptyWorkingSet(hProcess: *mut winapi::ctypes::c_void) -> BOOL;
            fn SetSystemFileCacheSize(
                minimum_file_cache_size: usize,
                maximum_file_cache_size: usize,
                flags: u32,
            ) -> BOOL;
            fn NtSetSystemInformation(
                SystemInformationClass: i32,
                SystemInformation: *mut u8,
                SystemInformationLength: u32,
            ) -> i32;
        }

        unsafe {
            let mut pids: Vec<DWORD> = vec![0u32; 4096];
            let mut bytes_needed: DWORD = 0;
            let enum_ok = EnumProcesses(
                pids.as_mut_ptr(),
                (pids.len() * std::mem::size_of::<DWORD>()) as DWORD,
                &mut bytes_needed,
            );
            if enum_ok != 0 {
                let count = bytes_needed as usize / std::mem::size_of::<DWORD>();
                pids.truncate(count);

                let my_pid = GetCurrentProcessId();
                let mut success_count: u32 = 0;
                for &pid in &pids {
                    if pid == 0 || pid == my_pid { continue; }
                    let access = PROCESS_SET_QUOTA | PROCESS_QUERY_INFORMATION | PROCESS_VM_READ;
                    let handle = OpenProcess(access, FALSE as i32, pid);
                    if handle.is_null() { continue; }
                    // 只要没 ACCESS_DENIED，就一定会成功把工作集丢到 standby
                    EmptyWorkingSet(handle);
                    success_count += 1;
                    CloseHandle(handle);
                }
                methods.push(format!(
                    "windows.empty_working_set({} processes)",
                    success_count
                ));
            }

            // SetSystemFileCacheSize(0, SIZE_MAX, FILE_CACHE_MAX_HARD_DISABLE)
            // 强制收缩系统文件缓存工作集
            if SetSystemFileCacheSize(0, usize::MAX, 2) != 0 {
                methods.push("windows.system_cache_hard_trim".to_string());
            }

            // 管理员模式大招：NtSetSystemInformation(80)
            // SystemPurgeStandbyList —— 把 standby 列表全部清到 free
            // 普通用户调了会失败（静默忽略）
            let status = NtSetSystemInformation(80, std::ptr::null_mut(), 0);
            if status == 0 {
                methods.push("windows.purge_standby_list(admin)".to_string());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux：drop_caches（需 root）+ 通过 /proc/<pid>/clear_refs
        // 尝试让内核回收各进程的未用页
        use std::fs::OpenOptions;
        use std::io::Write;
        if let Ok(mut f) = OpenOptions::new()
            .write(true)
            .open("/proc/sys/vm/drop_caches")
        {
            if f.write_all(b"3\n").is_ok() {
                methods.push("linux.drop_caches(3)".to_string());
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // macOS 上的"purge"思路：普通权限下我们无法直接调用系统 purge，
        // 但我们可以通过以下方式让系统回收 inactive/compressed 的内存：
        //
        //   1) 用 sysctl 读取当前内存压力：machdep.memorystatus_level
        //   2) 使用 xnu 提供的 libc 的 setpriority(PRIO_DARWIN_ROLE, ...)
        //      或使用 mach 让内核压缩清理其他进程的冷内存
        //
        // 最有效的普通权限手段：分配一块较大的内存然后释放，
        // 迫使 macOS 的 memorystatus/compressor 工作，从而释放 inactive 页。
        // 这里我们做"内存压力"式的分配：先用 mmap 分配大块，
        // touch 页面让内核实际提交物理内存，然后用 madvise(DONTNEED)
        // 告诉内核可以丢弃它们，最后 munmap。

        unsafe {
            use libc::{c_int, c_void, size_t};

            // 获取当前系统总内存（sysctl hw.memsize）
            let mut total: u64 = 0;
            let mut total_len: size_t = std::mem::size_of::<u64>();
            let name: [c_int; 2] = [6 /* CTL_HW */, 24 /* HW_MEMSIZE */];
            extern "C" {
                fn sysctl(
                    name: *const c_int,
                    namelen: c_int,
                    oldp: *mut c_void,
                    oldlenp: *mut size_t,
                    newp: *const c_void,
                    newlen: size_t,
                ) -> c_int;
            }
            let ret = sysctl(
                name.as_ptr(), 2,
                &mut total as *mut u64 as *mut c_void,
                &mut total_len,
                std::ptr::null(), 0,
            );
            if ret == 0 && total > 0 {
                // 分配总内存 10% 的内存（但不超过 1GB），迫使内存压缩器工作
                let mut target = (total / 10) as size_t;
                let cap: size_t = 1024 * 1024 * 1024; // 1GB 上限
                if target > cap { target = cap; }

                // 对齐到页面大小
                let page_size = libc::sysconf(libc::_SC_PAGESIZE) as size_t;
                if page_size > 0 {
                    target = (target / page_size) * page_size;
                }

                if target > 0 {
                    let mut ok_rounds = 0usize;
                    // 分多次分配：一次 256MB，让内核有机会逐步回收
                    let step: size_t = 256 * 1024 * 1024;
                    let mut remain = target;
                    while remain > 0 {
                        let this = if remain > step { step } else { remain };
                        let ptr = libc::mmap(
                            std::ptr::null_mut(),
                            this,
                            libc::PROT_READ | libc::PROT_WRITE,
                            libc::MAP_ANON | libc::MAP_PRIVATE,
                            -1, 0,
                        );
                        if ptr == libc::MAP_FAILED {
                            break;
                        }
                        // touch 每页迫使内核分配物理页
                        let mut offset = 0isize;
                        while offset < this as isize {
                            let p = ptr.offset(offset) as *mut u8;
                            *p = 1;
                            offset += 4096;
                        }
                        // MADV_FREE = 5（macOS XNU 的值）：
                        // 告诉内核这些页面不需要保留，可以随时回收
                        libc::madvise(ptr, this, 5);
                        libc::munmap(ptr, this);
                        ok_rounds += 1;
                        remain -= this;

                        // 给内核一点时间来反映压缩/回收
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }

                    if ok_rounds > 0 {
                        methods.push(format!(
                            "macos.pressure_alloc({} rounds, ~{}MB)",
                            ok_rounds,
                            (ok_rounds * 256)
                        ));
                    }
                }
            }
        }

        // 再试一次 purge 命令（带 sudo 提示的失败不影响）
        let status = std::process::Command::new("/usr/bin/purge")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        if let Ok(s) = status {
            if s.success() {
                methods.push("macos.purge".to_string());
            }
        }
    }
}

/// 决定"内存抖动"分配多大一块（字节）
/// 规则：取"可用内存的 1/8 或 128MB，取较小者"
fn platform_memory_jitter_size_bytes() -> u64 {
    let mut sys = System::new();
    sys.refresh_memory();
    let available_kb = sys.available_memory();
    let eighth_bytes = available_kb.saturating_mul(1024) / 8;
    let upper_bound: u64 = 128 * 1024 * 1024; // 128 MB 字节
    let size = std::cmp::min(eighth_bytes, upper_bound);
    // 至少 16MB 才值得做一次
    if size < 16 * 1024 * 1024 {
        0
    } else {
        size
    }
}

/// 分配 size 字节内存、touch 每个 4KB 页一次、然后释放。
fn memory_jitter(size: u64) {
    let size = size as usize;

    #[cfg(target_os = "macos")]
    {
        // macOS：直接用 mmap 分配匿名内存，touch 每页，
        // 然后用 MADV_FREE (5) 让内核丢弃，最后 munmap。
        // 这直接触发内存压缩器，比 Vec<u8> 更可靠。
        unsafe {
            let ptr = libc::mmap(
                std::ptr::null_mut(),
                size,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_ANON | libc::MAP_PRIVATE,
                -1, 0,
            );
            if ptr != libc::MAP_FAILED {
                let page = 4096isize;
                let mut off = 0isize;
                let max = size as isize;
                while off < max {
                    let p = ptr.offset(off) as *mut u8;
                    *p = 1;
                    off += page;
                }
                // MADV_FREE = 5：告诉内核可以丢弃这些页
                libc::madvise(ptr, size, 5);
                libc::munmap(ptr, size);
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        // 其他平台：用 Vec<u8> 的零初始化 + 写入
        let mut v: Vec<u8> = vec![0u8; size];
        let page = 4096usize;
        let mut i = 0usize;
        while i < size {
            v[i] = 1;
            i += page;
        }
        v[size - 1] = 1;
        drop(v);
    }
}

// 在非三大平台上，给 linker 一个空实现，避免编译失败
#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn platform_trim_current_process(_methods: &mut Vec<String>) {}
#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn platform_drop_file_caches(_methods: &mut Vec<String>) {}
#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn platform_try_empty_system_caches(methods: &mut Vec<String>) {}

// ---------------------------------------------------------------------------
//  startup：启动时自动生成 launcher_profiles.json
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct LauncherProfile {
    icon: String,
    name: String,
    lastVersionId: String,
    #[serde(rename = "type")]
    typ: String,
    lastUsed: i64,
}

#[derive(Serialize)]
struct LauncherProfiles {
    profiles: std::collections::BTreeMap<String, LauncherProfile>,
    selectedProfile: String,
    clientToken: String,
}

fn startup_minecraft_paths() -> Vec<String> {
    // 与 config.rs 保持一致：读取 RTL/config/launcher.json 拿到所有 minecraft 路径
    // 也始终包含一份「平台默认路径」兜底
    #[cfg(target_os = "windows")]
    let default_path = {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        exe_dir.join("minecraft").to_string_lossy().to_string()
    };
    #[cfg(target_os = "macos")]
    let default_path = {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        format!("{}/Library/Application Support/RTLauncher/version", home)
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let default_path = "./minecraft".to_string();

    #[cfg(target_os = "macos")]
    let config_file = {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        std::path::PathBuf::from(format!("{}/Library/Application Support/RTLauncher/config", home))
            .join("launcher.json")
    };
    #[cfg(not(target_os = "macos"))]
    let config_file = std::path::PathBuf::from("./RTL/config").join("launcher.json");

    let mut paths: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    paths.insert(default_path);

    if config_file.exists() {
        if let Ok(text) = fs::read_to_string(&config_file) {
            // 只关心 minecraft_paths / selected_minecraft_path 两个字段
            #[derive(serde::Deserialize)]
            struct PartialConfig {
                minecraft_paths: Option<Vec<String>>,
                selected_minecraft_path: Option<String>,
            }
            if let Ok(cfg) = serde_json::from_str::<PartialConfig>(&text) {
                if let Some(list) = cfg.minecraft_paths {
                    for p in list { paths.insert(p); }
                }
                if let Some(p) = cfg.selected_minecraft_path {
                    paths.insert(p);
                }
            }
        }
    }

    paths.into_iter().collect()
}

/// 启动时自动检查：对所有已配置的 minecraft 路径，
/// 若缺少 launcher_profiles.json 则生成一份；
/// 若已存在则不覆盖（保留用户设置）。
/// 在独立线程中调用，不阻塞 UI。
pub fn ensure_launcher_profiles_on_startup() {
    let paths = startup_minecraft_paths();
    let now_unix = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    for mc_path in paths {
        let dir = Path::new(&mc_path);
        if let Err(e) = fs::create_dir_all(dir) {
            eprintln!("[launcher_profiles] 创建目录失败 {}: {}", mc_path, e);
            continue;
        }

        let file = dir.join("launcher_profiles.json");
        if file.exists() {
            // 已存在则不覆盖，保留用户设置
            continue;
        }

        let mut profiles_map = std::collections::BTreeMap::new();
        profiles_map.insert("RTL".to_string(), LauncherProfile {
            icon: "Grass".to_string(),
            name: "RTL".to_string(),
            lastVersionId: "latest-release".to_string(),
            typ: "latest-release".to_string(),
            lastUsed: now_unix,
        });

        let lp = LauncherProfiles {
            profiles: profiles_map,
            selectedProfile: "RTL".to_string(),
            clientToken: "23323323323323323323323323323333".to_string(),
        };

        match serde_json::to_string_pretty(&lp) {
            Ok(json) => {
                if let Err(e) = fs::write(&file, &json) {
                    eprintln!("[launcher_profiles] 写入失败 {}: {}", file.display(), e);
                } else {
                    eprintln!("[launcher_profiles] 已生成 {}", file.display());
                }
            }
            Err(e) => {
                eprintln!("[launcher_profiles] 序列化失败: {}", e);
            }
        }
    }
}