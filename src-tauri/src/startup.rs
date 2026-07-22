use winreg::enums::*;
use winreg::RegKey;
use std::env;

#[tauri::command]
pub fn set_autostart(enable: bool) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = r"Software\Microsoft\Windows\CurrentVersion\Run";
    
    let key = hkcu.open_subkey_with_flags(path, KEY_WRITE).map_err(|e| e.to_string())?;
    
    if enable {
        let current_exe = env::current_exe()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .into_owned();
        
        let command = format!("\"{current_exe}\" --background");
        key.set_value("YZaiDesk", &command).map_err(|e| e.to_string())?;
    } else {
        match key.delete_value("YZaiDesk") {
            Ok(_) => {},
            Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => {},
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_autostart() -> Result<bool, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = r"Software\Microsoft\Windows\CurrentVersion\Run";
    
    let key = hkcu.open_subkey_with_flags(path, KEY_READ).map_err(|e| e.to_string())?;
    
    let val: Result<String, _> = key.get_value("YZaiDesk");
    match val {
        Ok(_) => Ok(true),
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}
