use serde::Serialize;
use std::mem::{size_of, zeroed};
use windows_sys::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
use windows_sys::Win32::System::Threading::GetCurrentProcess;

#[derive(Serialize)]
pub struct ProcessMemoryStatus {
    working_set_bytes: u64,
    working_set_mb: f64,
}

#[tauri::command]
pub fn get_process_memory() -> Result<ProcessMemoryStatus, String> {
    let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { zeroed() };
    counters.cb = size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
    let success = unsafe {
        K32GetProcessMemoryInfo(
            GetCurrentProcess(),
            &mut counters,
            size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        )
    };
    if success == 0 {
        return Err("无法读取当前应用的内存占用".to_string());
    }
    let working_set_bytes = counters.WorkingSetSize as u64;
    Ok(ProcessMemoryStatus {
        working_set_bytes,
        working_set_mb: working_set_bytes as f64 / 1024.0 / 1024.0,
    })
}
