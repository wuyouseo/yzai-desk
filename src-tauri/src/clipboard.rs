use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use arboard::Clipboard;
use serde::{Deserialize, Serialize};
use serde_json::json;
use crate::db;

#[derive(Clone, Serialize, Deserialize)]
pub struct ClipboardItem {
    pub id: String,
    pub text: String,
    pub copied_at: String,
    pub pinned: bool,
    pub is_sensitive: bool,
}

fn get_last_clipboard_text() -> &'static Mutex<String> {
    static LAST_CLIPBOARD_TEXT: OnceLock<Mutex<String>> = OnceLock::new();
    LAST_CLIPBOARD_TEXT.get_or_init(|| Mutex::new(String::new()))
}

fn get_sensitive_copy_time() -> &'static Mutex<Option<(String, Instant)>> {
    static SENSITIVE_COPY_TIME: OnceLock<Mutex<Option<(String, Instant)>>> = OnceLock::new();
    SENSITIVE_COPY_TIME.get_or_init(|| Mutex::new(None))
}

// Simple helper to check if a text is likely sensitive (passwords, tokens, keys)
fn check_is_sensitive(text: &str) -> bool {
    let t = text.trim();
    if t.is_empty() {
        return false;
    }
    
    // Check common API key prefixes
    if t.starts_with("sk-") || t.starts_with("ghp_") || t.starts_with("ey") || t.starts_with("xoxb-") {
        return true;
    }
    
    // Check if it looks like a password (long hex, base64, or high complexity with no spaces)
    if t.len() >= 12 && !t.contains(' ') {
        let has_digit = t.chars().any(|c| c.is_ascii_digit());
        let has_uppercase = t.chars().any(|c| c.is_ascii_uppercase());
        let has_lowercase = t.chars().any(|c| c.is_ascii_lowercase());
        let has_special = t.chars().any(|c| !c.is_ascii_alphanumeric());
        
        // If it contains a mix of categories, mark as sensitive
        let score = (has_digit as u8) + (has_uppercase as u8) + (has_lowercase as u8) + (has_special as u8);
        if score >= 3 {
            return true;
        }
    }
    
    false
}

pub fn start_clipboard_listener(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut clipboard = match Clipboard::new() {
            Ok(cb) => cb,
            Err(e) => {
                eprintln!("Failed to initialize clipboard listener: {}", e);
                return;
            }
        };

        loop {
            // Read clipboard text
            if let Ok(text) = clipboard.get_text() {
                let trimmed = text.trim().to_string();
                
                if !trimmed.is_empty() {
                    let mut last_text = get_last_clipboard_text().lock().unwrap();
                    
                    if trimmed != *last_text {
                        *last_text = trimmed.clone();
                        drop(last_text); // Release lock
                        
                        let is_sensitive = check_is_sensitive(&trimmed);
                        let now = chrono::Local::now().to_rfc3339();
                        let id = uuid::Uuid::new_v4().to_string();
                        
                        let new_item = ClipboardItem {
                            id: id.clone(),
                            text: trimmed.clone(),
                            copied_at: now.clone(),
                            pinned: false,
                            is_sensitive,
                        };
                        
                        // Update Database
                        let item_for_db = new_item.clone();
                        let _ = db::update_db(|data| {
                            if let Some(arr) = data.get_mut("clipboard").and_then(|value| value.as_array_mut()) {
                                // Insert at beginning
                                arr.insert(0, json!(item_for_db));
                                
                                // Limit to 100 items (keep pinned items!)
                                if arr.len() > 100 {
                                    let mut kept_arr = Vec::new();
                                    let mut unpinned_count = 0;
                                    
                                    for item in arr.iter() {
                                        let is_pinned = item.get("pinned").and_then(|p| p.as_bool()).unwrap_or(false);
                                        if is_pinned {
                                            kept_arr.push(item.clone());
                                        } else if unpinned_count < 80 {
                                            kept_arr.push(item.clone());
                                            unpinned_count += 1;
                                        }
                                    }
                                    *arr = kept_arr;
                                }
                            }
                            ((), true)
                        });
                        
                        // Emit event to frontend
                        let _ = app_handle.emit("clipboard-changed", new_item);
                        
                        // Handle sensitive text timer
                        if is_sensitive {
                            let mut sensitive_lock = get_sensitive_copy_time().lock().unwrap();
                            *sensitive_lock = Some((trimmed.clone(), Instant::now()));
                        }
                    }
                }
            }

            // Check if sensitive clipboard needs clearing (3 minutes = 180 seconds)
            let expired_sensitive_text = {
                let sensitive_lock = get_sensitive_copy_time().lock().unwrap();
                sensitive_lock
                    .as_ref()
                    .filter(|(_, copy_time)| copy_time.elapsed() >= Duration::from_secs(180))
                    .map(|(text, _)| text.clone())
            };

            if let Some(sensitive_text) = expired_sensitive_text {
                // Read DB settings only after releasing the state lock so the
                // listener never holds a synchronous mutex across async work.
                let db_data = db::read_db();
                let sensitive_clear_enabled = db_data
                    .get("settings")
                    .and_then(|s| s.get("sensitive_auto_clear"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);

                if sensitive_clear_enabled {
                    if let Ok(current_text) = clipboard.get_text() {
                        if current_text == sensitive_text {
                            let _ = clipboard.clear();
                            let _ = app_handle.emit("clipboard-cleared", ());
                        }
                    }
                }

                let mut sensitive_lock = get_sensitive_copy_time().lock().unwrap();
                *sensitive_lock = None;
            }

            // Sleep for 800ms
            tokio::time::sleep(Duration::from_millis(800)).await;
        }
    });
}

#[tauri::command]
pub fn clean_paste(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    // Overwrite clipboard with plain cleaned text
    clipboard.set_text(text).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clear_clipboard() -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    let _ = clipboard.clear();
    
    // Clear ordinary history records while always preserving pinned entries.
    // This mirrors the UI's one-click cleanup protection and makes the safety
    // rule hold even when the command is invoked from another window.
    db::update_db(|data| {
        if let Some(arr) = data.get_mut("clipboard").and_then(|c| c.as_array_mut()) {
            arr.retain(|item| item.get("pinned").and_then(|value| value.as_bool()).unwrap_or(false));
        }
        ((), true)
    })?;
    Ok(())
}
