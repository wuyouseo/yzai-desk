use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use serde::{Deserialize, Serialize};
use serde_json::json;
use chrono::{DateTime, Local, Datelike, Duration as ChronoDuration, Timelike, TimeZone};
use crate::db;

#[derive(Clone, Serialize, Deserialize)]
pub struct PomoSession {
    pub target_time: String, // ISO String
    pub duration_mins: u32,
    pub label: String,
    #[serde(default)]
    pub remaining_seconds: u64,
    #[serde(default = "default_running")]
    pub running: bool,
}

fn default_running() -> bool {
    true
}

fn default_event_kind() -> String {
    "schedule".to_string()
}

fn default_event_remind() -> bool {
    true
}

#[derive(Clone, Serialize, Deserialize)]
pub struct EventItem {
    pub id: String,
    pub title: String,
    pub time: String, // ISO String
    #[serde(default = "default_event_kind")]
    pub kind: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default = "default_event_remind")]
    pub remind: bool,
    #[serde(default)]
    pub notified_at: Option<String>,
    pub recurring: String, // "none", "daily", "weekly", "monthly", "yearly"
    pub done: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SnoozedNotification {
    pub target_time: String,
    pub notif_type: String,
    pub message: String,
}

fn get_pomo_state() -> &'static Mutex<Option<PomoSession>> {
    static POMO_STATE: OnceLock<Mutex<Option<PomoSession>>> = OnceLock::new();
    POMO_STATE.get_or_init(|| {
        let restored = db::read_db()
            .get("pomo_state")
            .filter(|value| !value.is_null())
            .and_then(|value| serde_json::from_value::<PomoSession>(value.clone()).ok());
        Mutex::new(restored)
    })
}

fn get_snoozed_notifications() -> &'static Mutex<Vec<SnoozedNotification>> {
    static SNOOZED_NOTIFICATIONS: OnceLock<Mutex<Vec<SnoozedNotification>>> = OnceLock::new();
    SNOOZED_NOTIFICATIONS.get_or_init(|| Mutex::new(Vec::new()))
}

fn persist_pomo_state(session: Option<&PomoSession>) -> Result<(), String> {
    db::update_db(|data| {
        data["pomo_state"] = match session {
            Some(value) => json!(value),
            None => serde_json::Value::Null,
        };
        ((), true)
    })
}

pub fn start_alarm_scheduler(app_handle: AppHandle) {
    let _ = get_pomo_state();
    tauri::async_runtime::spawn(async move {
        loop {
            let now = Local::now();
            // 1. Check Events
            let triggered_events = db::update_db(|data| {
                let mut db_changed = false;
                let mut triggered_events = Vec::new();
                if let Some(events_arr) = data.get_mut("events").and_then(|e| e.as_array_mut()) {
                    for event_val in events_arr.iter_mut() {
                        if let Ok(mut event) = serde_json::from_value::<EventItem>(event_val.clone()) {
                            if !event.done && event.remind && event.kind != "memo" && event.notified_at.is_none() {
                                if let Ok(event_time) = DateTime::parse_from_rfc3339(&event.time) {
                                    let event_time_local = event_time.with_timezone(&Local);
                                    if now >= event_time_local {
                                        triggered_events.push(event.clone());
                                        db_changed = true;
                                        match event.recurring.as_str() {
                                            "daily" => {
                                                event.time = (event_time_local + ChronoDuration::days(1)).to_rfc3339();
                                                event.notified_at = None;
                                            },
                                            "weekly" => {
                                                event.time = (event_time_local + ChronoDuration::days(7)).to_rfc3339();
                                                event.notified_at = None;
                                            },
                                            "monthly" => {
                                                let mut next_month = event_time_local.month() + 1;
                                                let mut next_year = event_time_local.year();
                                                if next_month > 12 { next_month = 1; next_year += 1; }
                                                if let Some(next_time) = Local.with_ymd_and_hms(
                                                    next_year, next_month, std::cmp::min(event_time_local.day(), 28),
                                                    event_time_local.hour(), event_time_local.minute(), event_time_local.second(),
                                                ).single() {
                                                    event.time = next_time.to_rfc3339();
                                                    event.notified_at = None;
                                                } else {
                                                    event.done = true;
                                                }
                                            },
                                            "yearly" => {
                                                if let Some(next_time) = Local.with_ymd_and_hms(
                                                    event_time_local.year() + 1, event_time_local.month(), std::cmp::min(event_time_local.day(), 28),
                                                    event_time_local.hour(), event_time_local.minute(), event_time_local.second(),
                                                ).single() {
                                                    event.time = next_time.to_rfc3339();
                                                    event.notified_at = None;
                                                } else {
                                                    event.done = true;
                                                }
                                            },
                                            _ => event.notified_at = Some(now.to_rfc3339()),
                                        }
                                        *event_val = json!(event);
                                    }
                                }
                            }
                        }
                    }
                }
                (triggered_events, db_changed)
            }).unwrap_or_else(|error| {
                eprintln!("Failed to check scheduled events: {error}");
                Vec::new()
            });

            for event in triggered_events {
                let notification_type = if event.kind == "reminder" { "reminder" } else { "event" };
                show_notification(&app_handle, notification_type, &event.title);
            }

            // 2. Re-show notifications that the user snoozed earlier.
            let ready_notifications = {
                let mut queue = get_snoozed_notifications().lock().unwrap();
                let mut ready = Vec::new();
                queue.retain(|item| {
                    let is_ready = DateTime::parse_from_rfc3339(&item.target_time)
                        .map(|target| now >= target.with_timezone(&Local))
                        .unwrap_or(true);
                    if is_ready {
                        ready.push(item.clone());
                        false
                    } else {
                        true
                    }
                });
                ready
            };

            for notification in ready_notifications {
                show_notification(&app_handle, &notification.notif_type, &notification.message);
            }
            
            // 3. Check Pomodoro
            let mut pomo_finished = false;
            let mut pomo_label = String::new();
            let mut pomo_duration_mins = 0;
            
            {
                let mut pomo_lock = get_pomo_state().lock().unwrap();
                if let Some(session) = &*pomo_lock {
                    if session.running {
                        if let Ok(target) = DateTime::parse_from_rfc3339(&session.target_time) {
                            let target_local = target.with_timezone(&Local);
                            if now >= target_local {
                                pomo_finished = true;
                                pomo_label = session.label.clone();
                                pomo_duration_mins = session.duration_mins;
                                *pomo_lock = None; // Reset pomo
                            }
                        }
                    }
                }
            }
            
            if pomo_finished {
                let _ = persist_pomo_state(None);
                // Show notification
                let msg = if pomo_label.is_empty() {
                    "专注时间结束，休息一下吧！".to_string()
                } else {
                    format!("番茄钟「{}」已完成，休息一下吧！", pomo_label)
                };
                show_notification(&app_handle, "pomo", &msg);
                
                // Save Pomodoro stat to database
                let today = now.format("%Y-%m-%d").to_string();
                let _ = db::update_db(|data| {
                    if !data["pomo_stats"].is_object() { data["pomo_stats"] = json!({}); }
                    if let Some(stats) = data["pomo_stats"].as_object_mut() {
                        let current_count = stats.get(&today).and_then(|c| c.as_u64()).unwrap_or(0);
                        stats.insert(today.clone(), json!(current_count + 1));
                    }
                    if !data["pomo_minutes"].is_object() { data["pomo_minutes"] = json!({}); }
                    if let Some(minutes) = data["pomo_minutes"].as_object_mut() {
                        let current_minutes = minutes.get(&today).and_then(|c| c.as_u64()).unwrap_or(0);
                        minutes.insert(today.clone(), json!(current_minutes + pomo_duration_mins as u64));
                    }
                    ((), true)
                });
                
                let _ = app_handle.emit("pomo-finished", pomo_label);
            }
            
            // Tick every 1 second
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
}

fn show_notification(app_handle: &AppHandle, notif_type: &str, message: &str) {
    if let Some(notif_win) = app_handle.get_webview_window("notification") {
        // Emit trigger details to the notification window
        let _ = notif_win.emit("trigger-alarm", json!({
            "type": notif_type,
            "message": message
        }));
        
        // Re-center every time so a previously moved or hidden popup never reappears at (0, 0).
        let _ = notif_win.center();
        let _ = notif_win.show();
        let _ = notif_win.set_focus();
    }
}

#[tauri::command]
pub fn hide_notification(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("notification")
        .ok_or_else(|| "提醒窗口不存在".to_string())?;
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn start_pomo(seconds: u64, duration_mins: u32, label: String) -> Result<PomoSession, String> {
    let now = Local::now();
    let safe_seconds = seconds.max(1);
    let target = now + ChronoDuration::seconds(safe_seconds as i64);
    let session = PomoSession {
        target_time: target.to_rfc3339(),
        duration_mins: duration_mins.max(1),
        label,
        remaining_seconds: safe_seconds,
        running: true,
    };
    
    let mut pomo_lock = get_pomo_state().lock().unwrap();
    *pomo_lock = Some(session.clone());
    persist_pomo_state(Some(&session))?;
    Ok(session)
}

#[tauri::command]
pub fn pause_pomo() -> Result<Option<PomoSession>, String> {
    let now = Local::now();
    let mut pomo_lock = get_pomo_state().lock().unwrap();
    if let Some(session) = pomo_lock.as_mut() {
        if session.running {
            session.remaining_seconds = DateTime::parse_from_rfc3339(&session.target_time)
                .map(|target| (target.with_timezone(&Local) - now).num_seconds().max(0) as u64)
                .unwrap_or(session.remaining_seconds);
        }
        session.running = false;
        session.target_time.clear();
        persist_pomo_state(Some(session))?;
    }
    Ok(pomo_lock.clone())
}

#[tauri::command]
pub fn stop_pomo() -> Result<(), String> {
    let mut pomo_lock = get_pomo_state().lock().unwrap();
    *pomo_lock = None;
    persist_pomo_state(None)
}

#[tauri::command]
pub fn get_active_pomo() -> Result<Option<PomoSession>, String> {
    let pomo_lock = get_pomo_state().lock().unwrap();
    Ok(pomo_lock.clone())
}

#[tauri::command]
pub fn snooze_notification(
    notif_type: String,
    message: String,
    minutes: u32,
) -> Result<(), String> {
    let target = Local::now() + ChronoDuration::minutes(minutes.max(1) as i64);
    let mut queue = get_snoozed_notifications().lock().unwrap();
    queue.push(SnoozedNotification {
        target_time: target.to_rfc3339(),
        notif_type,
        message,
    });
    Ok(())
}
