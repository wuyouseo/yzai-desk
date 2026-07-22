use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use serde_json::json;
use tauri::Emitter;

pub fn get_db_path() -> PathBuf {
    let mut path = if let Ok(appdata) = std::env::var("APPDATA") {
        PathBuf::from(appdata)
    } else {
        // Fallback to home dir or temp dir if APPDATA is somehow not present
        std::env::temp_dir()
    };
    path.push("yzai-desk");
    path
}

fn db_lock() -> &'static Mutex<()> {
    static DB_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    DB_LOCK.get_or_init(|| Mutex::new(()))
}

pub fn init_db() -> Result<(), String> {
    let db_dir = get_db_path();
    if !db_dir.exists() {
        fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
    }
    
    let file_path = db_dir.join("data.json");
    if !file_path.exists() {
        let default_db = json!({
            "events": [],
            "notes": [],
            "clipboard": [],
            "pomo_stats": {},
            "pomo_minutes": {},
            "pomo_state": null,
            "ai_conversations": [],
            "settings": {
                "autostart": false,
                "theme": "obsidian",
                "system_font": "system",
                "font_size": 100,
                "opacity": 85,
                "blur": 20,
                "widget_compatibility_mode": true,
                "weather_city": "北京市",
                "weather_lat": 39.9042,
                "weather_lon": 116.4074,
                "ai_api_key": "",
                "ai_base_url": "https://api.deepseek.com",
                "ai_model": "deepseek-chat",
                "active_ai_provider_id": "deepseek-default",
                "ai_providers": [{
                    "id": "deepseek-default",
                    "name": "DeepSeek",
                    "protocol": "openai",
                    "base_url": "https://api.deepseek.com",
                    "model_id": "deepseek-chat",
                    "api_key": ""
                }],
                "pomo_duration": 25,
                "sensitive_auto_clear": true,
                "note_password_config": null,
                "mini_widgets": {
                    "calendar": { "visible": false, "position": null, "size": { "width": 300, "height": 340 } },
                    "note": { "visible": false, "position": null, "size": { "width": 300, "height": 250 } },
                    "focus": { "visible": false, "position": null, "size": { "width": 290, "height": 240 } },
                    "weather": { "visible": false, "position": null, "size": { "width": 300, "height": 175 } }
                }
            }
        });
        
        let content = serde_json::to_string_pretty(&default_db).map_err(|e| e.to_string())?;
        fs::write(&file_path, content).map_err(|e| e.to_string())?;
    } else {
        // v0.5.2 removed the legacy all-in-one widget. Drop only its obsolete
        // layout keys while preserving every independent widget and user item.
        update_db(|data| {
            let mut changed = false;
            if let Some(settings) = data.get_mut("settings").and_then(|value| value.as_object_mut()) {
                for key in ["widget_locked", "widget_position", "widget_size"] {
                    changed |= settings.remove(key).is_some();
                }
            }
            ((), changed)
        })?;
    }
    Ok(())
}

fn read_db_unlocked() -> serde_json::Value {
    let file_path = get_db_path().join("data.json");
    if let Ok(content) = fs::read_to_string(&file_path) {
        if let Ok(json) = serde_json::from_str(&content) {
            return json;
        }
    }
    // Return a default shell if reading fails
    json!({
        "events": [],
        "notes": [],
        "clipboard": [],
        "ai_conversations": [],
        "settings": {}
    })
}

fn write_db_unlocked(data: &serde_json::Value) -> Result<(), String> {
    let db_dir = get_db_path();
    let file_path = db_dir.join("data.json");
    let tmp_path = db_dir.join("data.json.tmp");
    let backup_path = db_dir.join("data.json.bak");
    
    let content = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    
    // Write the complete payload first. On Windows `rename` cannot replace an
    // existing destination, so keep the previous file as a rollback copy while
    // promoting the new payload.
    fs::write(&tmp_path, content).map_err(|e| e.to_string())?;

    if file_path.exists() {
        if backup_path.exists() {
            fs::remove_file(&backup_path).map_err(|e| e.to_string())?;
        }
        fs::rename(&file_path, &backup_path).map_err(|e| e.to_string())?;

        if let Err(error) = fs::rename(&tmp_path, &file_path) {
            let _ = fs::rename(&backup_path, &file_path);
            return Err(error.to_string());
        }

        let _ = fs::remove_file(&backup_path);
    } else {
        fs::rename(&tmp_path, &file_path).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

pub fn read_db() -> serde_json::Value {
    let _guard = db_lock().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    read_db_unlocked()
}

pub fn write_db(data: serde_json::Value) -> Result<(), String> {
    let _guard = db_lock().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    write_db_unlocked(&data)
}

/// Applies a read-modify-write transaction while holding the database lock.
/// The callback returns both its result and whether the file needs writing.
pub fn update_db<R, F>(update: F) -> Result<R, String>
where
    F: FnOnce(&mut serde_json::Value) -> (R, bool),
{
    let _guard = db_lock().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut data = read_db_unlocked();
    let (result, changed) = update(&mut data);
    if changed {
        write_db_unlocked(&data)?;
    }
    Ok(result)
}

#[tauri::command]
pub fn get_data() -> serde_json::Value {
    read_db()
}

#[tauri::command]
pub fn save_data(
    app: tauri::AppHandle,
    data: serde_json::Value,
    changed_sections: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let next = update_db(move |current| {
        if let Some(sections) = changed_sections {
            for section in sections {
                if let Some(value) = data.get(&section) {
                    current[section] = value.clone();
                }
            }
        } else {
            *current = if data.is_object() { data } else { json!({}) };
        }
        (current.clone(), true)
    })?;
    if let Some(settings) = next.get("settings") {
        let _ = app.emit("settings-changed", settings.clone());
    }
    Ok(next)
}

#[tauri::command]
pub fn export_data(path: String) -> Result<(), String> {
    let file_path = get_db_path().join("data.json");
    let dest_path = Path::new(&path);
    
    if file_path.exists() {
        fs::copy(&file_path, dest_path).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("本地数据不存在，无法导出".to_string())
    }
}

#[tauri::command]
pub fn import_data(path: String) -> Result<serde_json::Value, String> {
    let src_path = Path::new(&path);
    if !src_path.exists() {
        return Err("导入文件不存在".to_string());
    }
    
    let content = fs::read_to_string(src_path).map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|_| "导入的文件格式不正确，必须为合法的JSON格式".to_string())?;
        
    // Verify basic keys exist
    if json.get("events").is_none() || json.get("notes").is_none() || json.get("settings").is_none() {
        return Err("导入的数据结构不完整，无法识别为 YZai Desk 备份".to_string());
    }
    
    write_db(json.clone())?;
    Ok(json)
}
