use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use serde::{Deserialize, Serialize};
use serde_json::json;
use chrono::{DateTime, Local, Duration as ChronoDuration};
use crate::db;
use crate::event_schedule::{EventItem, next_recurring};

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

#[derive(Clone, Serialize, Deserialize)]
pub struct SnoozedNotification {
    pub target_time: String,
    pub notif_type: String,
    pub message: String,
}

fn get_pomo_state() -> &'static Mutex<Option<PomoSession>> {
    static POMO_STATE: OnceLock<Mutex<Option<PomoSession>>> = OnceLock::new();
    POMO_STATE.get_or_init(|| {
        let restored = db::read_db().ok()
            .as_ref().and_then(|data| data.get("pomo_state"))
            .filter(|value| !value.is_null())
            .and_then(|value| serde_json::from_value::<PomoSession>(value.clone()).ok());
        Mutex::new(restored)
    })
}

pub fn reload_pomo_state(data: &serde_json::Value) {
    let restored = data.get("pomo_state").filter(|v| !v.is_null()).and_then(|v| serde_json::from_value(v.clone()).ok());
    *get_pomo_state().lock().unwrap_or_else(|p| p.into_inner()) = restored;
}

fn notification_is_displayed() -> &'static Mutex<bool> {
    static DISPLAYED: OnceLock<Mutex<bool>> = OnceLock::new();
    DISPLAYED.get_or_init(|| Mutex::new(false))
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
        let mut first_run = true;
        loop {
            let now = Local::now();
            // 1. Check Events
            let (triggered_events, ready_notifications) = db::update_db(|data| {
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
                                        if event.recurring != "none" {
                                            if let Some(next) = next_recurring(&mut event, now) {
                                                event.time = next.to_rfc3339();
                                                event.notified_at = None;
                                            } else { event.done = true; }
                                        } else { event.notified_at = Some(now.to_rfc3339()); }
                                        event_val["time"] = json!(event.time);
                                        event_val["notified_at"] = json!(event.notified_at);
                                        event_val["recurring_day"] = json!(event.recurring_day);
                                        event_val["done"] = json!(event.done);
                                    }
                                }
                            }
                        }
                    }
                }
                let mut ready = Vec::new();
                if let Some(queue) = data.get_mut("snoozed_notifications").and_then(|v| v.as_array_mut()) {
                    queue.retain(|value| {
                        match serde_json::from_value::<SnoozedNotification>(value.clone()) {
                            Ok(item) if DateTime::parse_from_rfc3339(&item.target_time).map(|t| now >= t.with_timezone(&Local)).unwrap_or(true) => { ready.push(item); false },
                            _ => true,
                        }
                    });
                }
                db_changed |= !ready.is_empty();
                if !triggered_events.is_empty() || !ready.is_empty() {
                    if !data["pending_notifications"].is_array() { data["pending_notifications"] = json!([]); }
                    let pending = data["pending_notifications"].as_array_mut().unwrap();
                    for event in &triggered_events {
                        pending.push(json!({"type": if event.kind == "reminder" { "reminder" } else { "event" }, "message": event.title}));
                    }
                    for item in &ready { pending.push(json!({"type": item.notif_type, "message": item.message})); }
                }
                ((triggered_events, ready), db_changed)
            }).unwrap_or_else(|error| {
                eprintln!("Failed to check scheduled events: {error}");
                (Vec::new(), Vec::new())
            });

            if !triggered_events.is_empty() {
                if let Ok(data) = db::read_db() { let _ = app_handle.emit("data-changed", data); }
            }
            // The queue and event state were saved together; show the oldest item.
            if first_run || !triggered_events.is_empty() || !ready_notifications.is_empty() {
                ensure_pending_notification(&app_handle);
            }
            first_run = false;

            // Persist completion and statistics in one transaction before clearing the in-memory session.
            let completed = {
                let mut lock = get_pomo_state().lock().unwrap_or_else(|p| p.into_inner());
                let due = lock.as_ref().filter(|session| session.running && DateTime::parse_from_rfc3339(&session.target_time).map(|target| now >= target.with_timezone(&Local)).unwrap_or(false)).cloned();
                if let Some(session) = due {
                    let today = now.format("%Y-%m-%d").to_string();
                    match db::update_db(|data| {
                        data["pomo_state"] = serde_json::Value::Null;
                        if !data["pomo_stats"].is_object() { data["pomo_stats"] = json!({}); }
                        let count = data["pomo_stats"][&today].as_u64().unwrap_or(0);
                        data["pomo_stats"][&today] = json!(count + 1);
                        if !data["pomo_minutes"].is_object() { data["pomo_minutes"] = json!({}); }
                        let minutes = data["pomo_minutes"][&today].as_u64().unwrap_or(0);
                        data["pomo_minutes"][&today] = json!(minutes + session.duration_mins as u64);
                        let message = if session.label.is_empty() { "专注时间结束，休息一下吧！".to_string() }
                            else { format!("番茄钟「{}」已完成，休息一下吧！", session.label) };
                        if !data["pending_notifications"].is_array() { data["pending_notifications"] = json!([]); }
                        data["pending_notifications"].as_array_mut().unwrap().push(json!({"type": "pomo", "message": message}));
                        ((), true)
                    }) {
                        Ok(()) => { *lock = None; Some(session) },
                        Err(error) => { eprintln!("Failed to save completed focus session: {error}"); None },
                    }
                } else { None }
            };
            if let Some(session) = completed {
                ensure_pending_notification(&app_handle);
                let _ = app_handle.emit("pomo-finished", session.label);
            }

            // A five-second polling interval reduces idle disk reads; the UI uses the target time.
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

fn display_notification(app_handle: &AppHandle, notif_type: &str, message: &str) {
    if let Some(window) = app_handle.get_webview_window("notification") {
        let _ = window.emit("trigger-alarm", json!({"type": notif_type, "message": message}));
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn ensure_pending_notification(app: &AppHandle) {
    let mut displayed = notification_is_displayed().lock().unwrap_or_else(|p| p.into_inner());
    if *displayed { return; }
    if let Ok(data) = db::read_db() {
        if let Some(item) = data.get("pending_notifications").and_then(|v| v.as_array()).and_then(|v| v.first()) {
            let kind = item.get("type").and_then(|v| v.as_str()).unwrap_or("event");
            let message = item.get("message").and_then(|v| v.as_str()).unwrap_or("");
            *displayed = true;
            display_notification(app, kind, message);
        }
    }
}

pub fn reload_notifications(app: &AppHandle) {
    let mut displayed = notification_is_displayed().lock().unwrap_or_else(|p| p.into_inner());
    if let Some(window) = app.get_webview_window("notification") { let _ = window.hide(); }
    *displayed = false;
    drop(displayed);
    ensure_pending_notification(app);
}

#[tauri::command]
pub fn notification_ready(app: AppHandle) {
    *notification_is_displayed().lock().unwrap_or_else(|p| p.into_inner()) = false;
    ensure_pending_notification(&app);
}

#[tauri::command]
pub fn hide_notification(app: AppHandle) -> Result<(), String> {
    let mut displayed = notification_is_displayed().lock().unwrap_or_else(|p| p.into_inner());
    db::update_db(|data| {
        let mut changed = false;
        if let Some(queue) = data.get_mut("pending_notifications").and_then(|v| v.as_array_mut()) {
            if !queue.is_empty() { queue.remove(0); changed = true; }
        }
        ((), changed)
    })?;
    app.get_webview_window("notification").ok_or("提醒窗口不存在")?.hide().map_err(|e| e.to_string())?;
    *displayed = false;
    drop(displayed);
    ensure_pending_notification(&app);
    Ok(())
}

#[tauri::command]
pub fn set_pomo_duration(app: AppHandle, minutes: u32) -> Result<(), String> {
    if !(1..=240).contains(&minutes) { return Err("请输入 1 到 240 之间的整数分钟".into()); }
    let session = get_pomo_state().lock().unwrap_or_else(|p| p.into_inner());
    if session.is_some() { return Err("请先重置当前专注，再更改时长".into()); }
    let data = db::update_db(|data| {
        data["settings"]["pomo_duration"] = json!(minutes);
        (data.clone(), true)
    })?;
    drop(session);
    if let Some(settings) = data.get("settings") { let _ = app.emit("settings-changed", settings.clone()); }
    let _ = app.emit("data-changed", data);
    Ok(())
}

#[tauri::command]
pub fn start_pomo(app: AppHandle, seconds: u64, duration_mins: u32, label: String) -> Result<PomoSession, String> {
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
    if let Some(current) = pomo_lock.as_ref() {
        if current.running { return Err("已有专注正在进行，请先暂停或重置".into()); }
        if current.duration_mins != duration_mins || current.remaining_seconds.abs_diff(safe_seconds) > 1 {
            return Err("专注状态已在其他窗口改变，请刷新后重试".into());
        }
    }
    persist_pomo_state(Some(&session))?;
    *pomo_lock = Some(session.clone());
    let _ = app.emit("pomo-changed", Some(session.clone()));
    Ok(session)
}

#[tauri::command]
pub fn pause_pomo(app: AppHandle) -> Result<Option<PomoSession>, String> {
    let now = Local::now();
    let mut pomo_lock = get_pomo_state().lock().unwrap();
    if let Some(mut session) = pomo_lock.clone() {
        if session.running {
            session.remaining_seconds = DateTime::parse_from_rfc3339(&session.target_time)
                .map(|target| (target.with_timezone(&Local) - now).num_seconds().max(0) as u64)
                .unwrap_or(session.remaining_seconds);
        }
        session.running = false;
        session.target_time.clear();
        persist_pomo_state(Some(&session))?;
        *pomo_lock = Some(session);
    }
    let session = pomo_lock.clone();
    let _ = app.emit("pomo-changed", session.clone());
    Ok(session)
}

#[tauri::command]
pub fn stop_pomo(app: AppHandle) -> Result<(), String> {
    let mut pomo_lock = get_pomo_state().lock().unwrap();
    persist_pomo_state(None)?;
    *pomo_lock = None;
    let _ = app.emit("pomo-changed", Option::<PomoSession>::None);
    Ok(())
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
    db::update_db(|data| {
        if !data["snoozed_notifications"].is_array() { data["snoozed_notifications"] = json!([]); }
        data["snoozed_notifications"].as_array_mut().unwrap().push(json!(SnoozedNotification { target_time: target.to_rfc3339(), notif_type, message }));
        ((), true)
    })
}
