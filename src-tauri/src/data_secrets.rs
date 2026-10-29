use serde_json::json;
use std::fs;
use std::path::Path;

#[cfg(windows)]
fn protect_secret(input: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB};
    use windows_sys::Win32::Foundation::LocalFree;
    let source = CRYPT_INTEGER_BLOB { cbData: input.len() as u32, pbData: input.as_ptr() as *mut u8 };
    let mut result = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let success = unsafe {
        if encrypt { CryptProtectData(&source, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 1, &mut result) }
        else { CryptUnprotectData(&source, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 1, &mut result) }
    };
    if success == 0 { return Err(format!("Windows 密钥保护失败：{}", std::io::Error::last_os_error())); }
    let bytes = unsafe { std::slice::from_raw_parts(result.pbData, result.cbData as usize).to_vec() };
    unsafe { LocalFree(result.pbData as *mut std::ffi::c_void); }
    Ok(bytes)
}

pub(crate) fn transform_secrets(data: &mut serde_json::Value, encrypt: bool) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    fn transform(value: &mut serde_json::Value, encrypt: bool) -> Result<(), String> {
        if encrypt {
            if let Some(secret) = value.as_str().filter(|secret| !secret.is_empty()) {
                let protected = protect_secret(secret.as_bytes(), true)?;
                *value = json!({"scheme": "windows-dpapi", "value": STANDARD.encode(protected)});
            }
        } else if value.get("scheme").and_then(|v| v.as_str()) == Some("windows-dpapi") {
            let encoded = value.get("value").and_then(|v| v.as_str()).ok_or("密钥数据格式错误")?;
            let bytes = STANDARD.decode(encoded).map_err(|_| "密钥数据格式错误")?;
            *value = json!(String::from_utf8(protect_secret(&bytes, false)?).map_err(|_| "密钥数据格式错误")?);
        }
        Ok(())
    }
    if let Some(settings) = data.get_mut("settings") {
        if let Some(key) = settings.get_mut("ai_api_key") { transform(key, encrypt)?; }
        if let Some(providers) = settings.get_mut("ai_providers").and_then(|v| v.as_array_mut()) {
            for provider in providers { if let Some(key) = provider.get_mut("api_key") { transform(key, encrypt)?; } }
        }
    }
    Ok(())
}

pub(crate) fn redact_secrets(data: &mut serde_json::Value) {
    if let Some(settings) = data.get_mut("settings") {
        if let Some(key) = settings.get_mut("ai_api_key") { *key = json!(""); }
        if let Some(providers) = settings.get_mut("ai_providers").and_then(|v| v.as_array_mut()) {
            for provider in providers { if let Some(key) = provider.get_mut("api_key") { *key = json!(""); } }
        }
    }
}

pub(crate) fn read_db_file(file_path: &Path) -> Result<serde_json::Value, String> {
    let content = fs::read_to_string(file_path)
        .map_err(|error| format!("无法读取本地数据 {}：{error}。原文件未被修改，请检查存储目录。", file_path.display()))?;
    let mut data: serde_json::Value = serde_json::from_str(&content)
        .map_err(|error| format!("本地数据损坏 {}：{error}。原文件未被修改，请从备份恢复。", file_path.display()))?;
    if !data.is_object() {
        return Err(format!("本地数据格式无效 {}。原文件未被修改，请从备份恢复。", file_path.display()));
    }
    transform_secrets(&mut data, false)?;
    Ok(data)
}


#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn protected_keys_roundtrip_and_backups_are_redacted() {
        let original = json!({"settings": {"ai_api_key": "legacy-secret", "ai_providers": [{"id":"p", "api_key":"example-secret"}]}});
        let mut protected = original.clone();
        transform_secrets(&mut protected, true).unwrap();
        let disk = serde_json::to_string(&protected).unwrap();
        assert!(!disk.contains("example-secret") && !disk.contains("legacy-secret"));
        transform_secrets(&mut protected, false).unwrap();
        assert_eq!(protected, original);
        redact_secrets(&mut protected);
        assert_eq!(protected["settings"]["ai_providers"][0]["api_key"], "");
    }
    #[test]
    fn damaged_data_is_rejected_without_overwriting() {
        let path = std::env::temp_dir().join(format!("yzai-corrupt-{}.json", std::process::id()));
        fs::write(&path, b"{broken").unwrap();
        assert!(read_db_file(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"{broken");
        fs::remove_file(path).unwrap();
    }
}
