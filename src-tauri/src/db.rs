use chrono::Local;
use serde::Serialize;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const DB_FILE: &str = "data.json";
const STORAGE_CONFIG_FILE: &str = "storage-location.json";

#[derive(Clone, Serialize)]
pub struct StorageInfo {
    pub root_path: String,
    pub data_file: String,
    pub backups_path: String,
    pub notes_path: String,
    pub ai_chats_path: String,
    pub default_path: String,
    pub is_custom: bool,
}

fn legacy_data_dir() -> PathBuf {
    let mut path = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    path.push("yzai-desk");
    path
}

fn default_data_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .map(|path| path.join("data"))
        .unwrap_or_else(|| legacy_data_dir().join("data"))
}

fn storage_config_path() -> PathBuf {
    legacy_data_dir().join(STORAGE_CONFIG_FILE)
}

fn configured_storage_dir() -> Option<PathBuf> {
    let content = fs::read_to_string(storage_config_path()).ok()?;
    let config: serde_json::Value = serde_json::from_str(&content).ok()?;
    let value = config.get("custom_path")?.as_str()?.trim();
    (!value.is_empty()).then(|| PathBuf::from(value))
}

fn write_storage_config(custom_path: Option<&Path>) -> Result<(), String> {
    let config_dir = legacy_data_dir();
    fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;
    let payload = json!({
        "custom_path": custom_path.map(|path| path.to_string_lossy().to_string())
    });
    let content = serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?;
    fs::write(storage_config_path(), content).map_err(|error| error.to_string())
}

pub fn get_db_path() -> PathBuf {
    configured_storage_dir().unwrap_or_else(default_data_dir)
}

fn db_lock() -> &'static Mutex<()> {
    static DB_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    DB_LOCK.get_or_init(|| Mutex::new(()))
}

fn ensure_storage_layout(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| error.to_string())?;
    for child in ["backups", "notes", "ai-chats"] {
        fs::create_dir_all(path.join(child)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn verify_writable(path: &Path) -> Result<(), String> {
    let test_path = path.join(format!(".yzai-write-test-{}", std::process::id()));
    fs::write(&test_path, b"ok").map_err(|error| format!("所选目录不可写：{error}"))?;
    fs::remove_file(test_path).map_err(|error| error.to_string())
}

fn default_db() -> serde_json::Value {
    json!({
        "events": [],
        "notes": [],
        "clipboard": [],
        "quadrant_tasks": [],
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
    })
}

fn sync_ai_archive(data: &serde_json::Value, db_dir: &Path) -> Result<(), String> {
    let archive_path = db_dir.join("ai-chats").join("conversations.json");
    let temp_path = db_dir.join("ai-chats").join("conversations.json.tmp");
    let conversations = data.get("ai_conversations").cloned().unwrap_or_else(|| json!([]));
    let content = serde_json::to_string_pretty(&conversations).map_err(|error| error.to_string())?;
    fs::write(&temp_path, content).map_err(|error| error.to_string())?;
    if archive_path.exists() {
        fs::remove_file(&archive_path).map_err(|error| error.to_string())?;
    }
    fs::rename(temp_path, archive_path).map_err(|error| error.to_string())
}

fn write_db_at(data: &serde_json::Value, db_dir: &Path) -> Result<(), String> {
    ensure_storage_layout(db_dir)?;
    let file_path = db_dir.join(DB_FILE);
    let tmp_path = db_dir.join("data.json.tmp");
    let backup_path = db_dir.join("data.json.bak");
    let content = serde_json::to_string_pretty(data).map_err(|error| error.to_string())?;

    fs::write(&tmp_path, content).map_err(|error| error.to_string())?;
    if file_path.exists() {
        if backup_path.exists() {
            fs::remove_file(&backup_path).map_err(|error| error.to_string())?;
        }
        fs::rename(&file_path, &backup_path).map_err(|error| error.to_string())?;
        if let Err(error) = fs::rename(&tmp_path, &file_path) {
            let _ = fs::rename(&backup_path, &file_path);
            return Err(error.to_string());
        }
        let _ = fs::remove_file(&backup_path);
    } else {
        fs::rename(&tmp_path, &file_path).map_err(|error| error.to_string())?;
    }

    if let Err(error) = sync_ai_archive(data, db_dir) {
        eprintln!("Failed to update AI conversation archive: {error}");
    }
    Ok(())
}

pub fn init_db() -> Result<(), String> {
    let configured = configured_storage_dir();
    let mut db_dir = configured.clone().unwrap_or_else(default_data_dir);
    if let Err(error) = ensure_storage_layout(&db_dir).and_then(|_| verify_writable(&db_dir)) {
        if configured.is_some() {
            return Err(error);
        }
        db_dir = legacy_data_dir();
        ensure_storage_layout(&db_dir)?;
        verify_writable(&db_dir)?;
        write_storage_config(Some(&db_dir))?;
    }

    let file_path = db_dir.join(DB_FILE);
    if !file_path.exists() {
        let legacy_path = legacy_data_dir().join(DB_FILE);
        if legacy_path.exists() && legacy_path != file_path {
            let content = fs::read_to_string(&legacy_path).map_err(|error| error.to_string())?;
            let data = serde_json::from_str(&content).map_err(|error| format!("旧版数据无法读取：{error}"))?;
            write_db_at(&data, &db_dir)?;
        } else {
            write_db_at(&default_db(), &db_dir)?;
        }
    } else if let Ok(content) = fs::read_to_string(&file_path) {
        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&content) {
            let _ = sync_ai_archive(&data, &db_dir);
        }
    }

    update_db(|data| {
        let mut changed = false;
        if let Some(settings) = data.get_mut("settings").and_then(|value| value.as_object_mut()) {
            for key in ["widget_locked", "widget_position", "widget_size"] {
                changed |= settings.remove(key).is_some();
            }
        }
        ((), changed)
    })
}

fn read_db_unlocked() -> serde_json::Value {
    let file_path = get_db_path().join(DB_FILE);
    if let Ok(content) = fs::read_to_string(&file_path) {
        if let Ok(json) = serde_json::from_str(&content) {
            return json;
        }
    }
    default_db()
}

fn write_db_unlocked(data: &serde_json::Value) -> Result<(), String> {
    write_db_at(data, &get_db_path())
}

pub fn read_db() -> serde_json::Value {
    let _guard = db_lock().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    read_db_unlocked()
}

pub fn write_db(data: serde_json::Value) -> Result<(), String> {
    let _guard = db_lock().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    write_db_unlocked(&data)
}

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

fn storage_info() -> StorageInfo {
    let root = get_db_path();
    let default = default_data_dir();
    StorageInfo {
        root_path: root.to_string_lossy().to_string(),
        data_file: root.join(DB_FILE).to_string_lossy().to_string(),
        backups_path: root.join("backups").to_string_lossy().to_string(),
        notes_path: root.join("notes").to_string_lossy().to_string(),
        ai_chats_path: root.join("ai-chats").to_string_lossy().to_string(),
        default_path: default.to_string_lossy().to_string(),
        is_custom: configured_storage_dir().is_some(),
    }
}

#[tauri::command]
pub fn get_storage_info() -> StorageInfo {
    storage_info()
}

#[tauri::command]
pub fn set_storage_directory(
    app: tauri::AppHandle,
    path: Option<String>,
) -> Result<StorageInfo, String> {
    let requested = path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let target = requested.clone().unwrap_or_else(default_data_dir);
    if !target.is_absolute() {
        return Err("请选择完整的绝对目录".to_string());
    }
    ensure_storage_layout(&target)?;
    verify_writable(&target)?;

    let _guard = db_lock().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let current_dir = get_db_path();
    let current_data = read_db_unlocked();
    let current_canonical = fs::canonicalize(&current_dir).unwrap_or(current_dir.clone());
    let target_canonical = fs::canonicalize(&target).unwrap_or(target.clone());

    if current_canonical != target_canonical {
        let target_file = target.join(DB_FILE);
        if target_file.exists() {
            let safety_name = format!("data-before-migration-{}.json", Local::now().format("%Y%m%d-%H%M%S"));
            fs::copy(&target_file, target.join("backups").join(safety_name))
                .map_err(|error| format!("无法备份目标目录中的原数据：{error}"))?;
        }
        write_db_at(&current_data, &target)?;
        let migration_name = format!("yzai-desk-migration-{}.json", Local::now().format("%Y%m%d-%H%M%S"));
        fs::copy(target.join(DB_FILE), target.join("backups").join(migration_name))
            .map_err(|error| format!("无法创建迁移备份：{error}"))?;
    }

    let default_canonical = fs::canonicalize(default_data_dir()).unwrap_or_else(|_| default_data_dir());
    let custom_path = (target_canonical != default_canonical).then_some(target.as_path());
    write_storage_config(custom_path)?;
    let info = storage_info();
    let _ = app.emit("storage-changed", info.clone());
    Ok(info)
}

#[tauri::command]
pub async fn choose_storage_directory() -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        let output = tauri::async_runtime::spawn_blocking(|| {
            let script = r#"Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = '选择咏智桌面工具数据保存位置'; $dialog.ShowNewFolderButton = $true; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }"#;
            let mut command = Command::new("powershell.exe");
            command
                .args(["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script])
                .creation_flags(0x08000000);
            command.output()
        })
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        let selected = String::from_utf8_lossy(&output.stdout)
            .trim_matches(|character: char| character.is_whitespace() || character == '\u{feff}')
            .to_string();
        return Ok((!selected.is_empty()).then_some(selected));
    }
    #[cfg(not(windows))]
    {
        Err("当前系统暂不支持文件夹选择".to_string())
    }
}

#[tauri::command]
pub fn open_storage_directory() -> Result<(), String> {
    let root = get_db_path();
    ensure_storage_layout(&root)?;
    #[cfg(windows)]
    {
        let mut command = Command::new("explorer.exe");
        command.arg(&root).creation_flags(0x08000000);
        command.spawn().map_err(|error| format!("无法打开数据目录：{error}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = root;
        Err("当前系统暂不支持打开数据目录".to_string())
    }
}

#[tauri::command]
pub fn create_backup() -> Result<String, String> {
    let _guard = db_lock().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = get_db_path();
    ensure_storage_layout(&root)?;
    let source = root.join(DB_FILE);
    if !source.exists() {
        return Err("本地数据不存在，无法创建备份".to_string());
    }
    let name = format!("yzai-desk-backup-{}.json", Local::now().format("%Y%m%d-%H%M%S"));
    let destination = root.join("backups").join(name);
    fs::copy(source, &destination).map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().to_string())
}

fn safe_file_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|character| if r#"\/:*?"<>|"#.contains(character) { '_' } else { character })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']);
    if trimmed.is_empty() {
        return "备忘录".to_string();
    }
    let limited: String = trimmed.chars().take(80).collect();
    let upper = limited.to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&upper.as_str())
        || (upper.len() == 4
            && (upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper.as_bytes()[3].is_ascii_digit());
    if reserved { format!("_{limited}") } else { limited }
}

#[tauri::command]
pub fn export_note_text(title: String, content: String) -> Result<String, String> {
    let _guard = db_lock().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = get_db_path();
    ensure_storage_layout(&root)?;
    let base = safe_file_name(&title);
    let mut destination = root.join("notes").join(format!("{base}.txt"));
    if destination.exists() {
        destination = root.join("notes").join(format!(
            "{}-{}.txt",
            base,
            Local::now().format("%Y%m%d-%H%M%S")
        ));
    }
    fs::write(&destination, content).map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
pub fn export_ai_chat_markdown(title: String, content: String) -> Result<String, String> {
    let _guard = db_lock().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = get_db_path();
    ensure_storage_layout(&root)?;
    let base = safe_file_name(&title);
    let mut destination = root.join("ai-chats").join(format!("{base}.md"));
    if destination.exists() {
        destination = root.join("ai-chats").join(format!(
            "{}-{}.md",
            base,
            Local::now().format("%Y%m%d-%H%M%S")
        ));
    }
    fs::write(&destination, content).map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().to_string())
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
    let _ = app.emit("data-changed", next.clone());
    Ok(next)
}

#[tauri::command]
pub fn export_data(path: String) -> Result<(), String> {
    let file_path = get_db_path().join(DB_FILE);
    let dest_path = Path::new(&path);
    if file_path.exists() {
        fs::copy(&file_path, dest_path).map_err(|error| error.to_string())?;
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
    let content = fs::read_to_string(src_path).map_err(|error| error.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|_| "导入的文件格式不正确，必须为合法的 JSON 格式".to_string())?;
    if json.get("events").is_none() || json.get("notes").is_none() || json.get("settings").is_none() {
        return Err("导入的数据结构不完整，无法识别为 YZai Desk 备份".to_string());
    }
    write_db(json.clone())?;
    Ok(json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_layout_writes_core_data_and_ai_archive() {
        let root = std::env::temp_dir().join(format!("yzai-storage-test-{}", std::process::id()));
        let data = json!({
            "events": [],
            "notes": [],
            "settings": {},
            "ai_conversations": [{ "id": "chat-1", "title": "测试对话", "messages": [] }]
        });

        write_db_at(&data, &root).expect("storage write should succeed");
        assert!(root.join(DB_FILE).is_file());
        assert!(root.join("backups").is_dir());
        assert!(root.join("notes").is_dir());
        assert!(root.join("ai-chats").join("conversations.json").is_file());

        let archive = fs::read_to_string(root.join("ai-chats").join("conversations.json")).unwrap();
        assert!(archive.contains("chat-1"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn note_export_names_are_safe_on_windows() {
        assert_eq!(safe_file_name(r#"计划:周一/周二?"#), "计划_周一_周二_");
        assert_eq!(safe_file_name("CON"), "_CON");
        assert_eq!(safe_file_name("..."), "备忘录");
    }
}
