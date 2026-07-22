use std::env;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::thread;
use std::time::Duration;

use tauri::AppHandle;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

use crate::window_custom;

const ACTION_ADDRESS: &str = "127.0.0.1:47631";
const DESKTOP_CONTEXT_MENU_KEY: &str = r"Software\Classes\DesktopBackground\Shell\YZaiDesk";

pub fn requested_action() -> Option<String> {
    let mut args = env::args().skip(1);
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--show-widget" => {
                let kind = args.next()?;
                if window_custom::MINI_WIDGET_KINDS.contains(&kind.as_str()) {
                    return Some(format!("widget:{kind}"));
                }
            }
            "--show-settings" => return Some("settings".to_string()),
            "--background" => return Some("background".to_string()),
            _ => {}
        }
    }
    None
}

pub fn forward_to_running_app(action: &str) -> bool {
    let Ok(address) = ACTION_ADDRESS.parse::<SocketAddr>() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(450)) else {
        return false;
    };
    stream.write_all(action.as_bytes()).is_ok()
}

fn dispatch_action(app: &AppHandle, action: &str) {
    if action == "settings" {
        let _ = window_custom::show_settings_window(app.clone());
    } else if let Some(kind) = action.strip_prefix("widget:") {
        let _ = window_custom::show_mini_widget_by_kind(app, kind);
    }
}

pub fn start_action_listener(app: AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind(ACTION_ADDRESS).map_err(|error| error.to_string())?;
    thread::spawn(move || {
        for incoming in listener.incoming() {
            let Ok(mut stream) = incoming else { continue };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
            let mut payload = [0_u8; 128];
            if let Ok(length) = stream.read(&mut payload) {
                let action = String::from_utf8_lossy(&payload[..length]).trim().to_string();
                if action.is_empty() {
                    continue;
                }
                let action_app = app.clone();
                let _ = app.run_on_main_thread(move || dispatch_action(&action_app, &action));
            }
        }
    });
    Ok(())
}

pub fn run_startup_action(app: &AppHandle, action: Option<&str>) {
    if let Some(action) = action {
        dispatch_action(app, action);
    }
}

pub fn register_desktop_context_menu() -> Result<(), String> {
    let executable = env::current_exe().map_err(|error| error.to_string())?;
    let executable = executable.to_string_lossy();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let base_path = DESKTOP_CONTEXT_MENU_KEY;
    // Recreate the whole branch so upgrades cannot leave stale submenu items.
    let _ = hkcu.delete_subkey_all(base_path);
    let (base, _) = hkcu.create_subkey(base_path).map_err(|error| error.to_string())?;
    base.set_value("MUIVerb", &"咏智桌面挂件").map_err(|error| error.to_string())?;
    base.set_value("Icon", &executable.as_ref()).map_err(|error| error.to_string())?;
    // Windows only provides canonical top/bottom placement for classic shell
    // verbs. Bottom keeps the app entry below the user's common desktop actions.
    base.set_value("Position", &"Bottom").map_err(|error| error.to_string())?;
    base.set_value("SubCommands", &"").map_err(|error| error.to_string())?;

    let items = [
        ("01_calendar", "添加桌面日历", "calendar"),
        ("02_note", "添加桌面备忘录", "note"),
        ("03_focus", "添加番茄时间", "focus"),
        ("04_weather", "添加天气挂件", "weather"),
    ];
    for (key_name, label, kind) in items {
        let item_path = format!(r"{base_path}\shell\{key_name}");
        let (item, _) = hkcu.create_subkey(&item_path).map_err(|error| error.to_string())?;
        item.set_value("MUIVerb", &label).map_err(|error| error.to_string())?;
        let (command, _) = item.create_subkey("command").map_err(|error| error.to_string())?;
        let value = format!("\"{executable}\" --show-widget {kind}");
        command.set_value("", &value).map_err(|error| error.to_string())?;
    }

    let settings_path = format!(r"{base_path}\shell\05_settings");
    let (settings, _) = hkcu.create_subkey(&settings_path).map_err(|error| error.to_string())?;
    settings.set_value("MUIVerb", &"打开挂件管理").map_err(|error| error.to_string())?;
    let (command, _) = settings.create_subkey("command").map_err(|error| error.to_string())?;
    let value = format!("\"{executable}\" --show-settings");
    command.set_value("", &value).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn unregister_desktop_context_menu() -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    match hkcu.delete_subkey_all(DESKTOP_CONTEXT_MENU_KEY) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn install_desktop_context_menu() -> Result<bool, String> {
    register_desktop_context_menu()?;
    Ok(true)
}

#[tauri::command]
pub fn remove_desktop_context_menu() -> Result<bool, String> {
    unregister_desktop_context_menu()?;
    Ok(false)
}
