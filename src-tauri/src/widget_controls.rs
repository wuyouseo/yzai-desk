use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use crate::{db, widget_geometry::{self, Rect}, window_custom};

#[derive(Clone)]
struct Gesture { rect: Rect, cursor: (i32, i32), scale: f64, mode: String, peers: Vec<Rect> }
fn gestures() -> &'static Mutex<HashMap<String, Gesture>> { static STATE: OnceLock<Mutex<HashMap<String, Gesture>>> = OnceLock::new(); STATE.get_or_init(Default::default) }
fn undo() -> &'static Mutex<HashMap<String, Rect>> { static STATE: OnceLock<Mutex<HashMap<String, Rect>>> = OnceLock::new(); STATE.get_or_init(Default::default) }
fn kind_for(window: &WebviewWindow) -> Result<&str, String> {
    let kind = window.label().strip_prefix("mini-").ok_or("此窗口不是桌面挂件")?;
    window_custom::mini_widget_label(kind)?; Ok(kind)
}
fn window_rect(window: &WebviewWindow) -> Result<Rect, String> {
    let p = window.outer_position().map_err(|e| e.to_string())?; let s = window.inner_size().map_err(|e| e.to_string())?;
    Ok(Rect { x: p.x, y: p.y, width: s.width as i32, height: s.height as i32 })
}
fn cursor() -> Result<(i32, i32), String> {
    let mut point = windows_sys::Win32::Foundation::POINT { x: 0, y: 0 };
    if unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point) } == 0 { return Err("无法获取鼠标位置".into()); }
    Ok((point.x, point.y))
}
fn area_at(window: &WebviewWindow, point: (i32, i32)) -> Result<Rect, String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let monitor = monitors.iter().find(|m| { let p = m.position(); let s = m.size(); point.0 >= p.x && point.0 < p.x + s.width as i32 && point.1 >= p.y && point.1 < p.y + s.height as i32 })
        .or_else(|| monitors.first()).ok_or("找不到可用显示器")?;
    let a = monitor.work_area(); Ok(Rect { x: a.position.x, y: a.position.y, width: a.size.width as i32, height: a.size.height as i32 })
}
fn scale_at(window: &WebviewWindow, point: (i32, i32)) -> Result<f64, String> {
    Ok(window.available_monitors().map_err(|e| e.to_string())?.iter().find(|m| {
        let p = m.position(); let s = m.size(); point.0 >= p.x && point.0 < p.x + s.width as i32 && point.1 >= p.y && point.1 < p.y + s.height as i32
    }).map(|m| m.scale_factor()).unwrap_or(window.scale_factor().map_err(|e| e.to_string())?))
}
fn apply_rect(window: &WebviewWindow, rect: Rect) -> Result<(), String> {
    window.set_size(PhysicalSize::new(rect.width as u32, rect.height as u32)).map_err(|e| e.to_string())?;
    window.set_position(PhysicalPosition::new(rect.x, rect.y)).map_err(|e| e.to_string())
}
fn persist(window: &WebviewWindow, kind: &str) -> Result<(), String> {
    window_custom::persist_mini_widget_geometry(kind, Some(window.outer_position().map_err(|e| e.to_string())?), Some(window.inner_size().map_err(|e| e.to_string())?), window_custom::widget_placement(window).ok())
}
fn publish(app: &AppHandle) -> Result<(), String> { let data = db::read_db()?; app.emit("settings-changed", data["settings"].clone()).map_err(|e| e.to_string())?; app.emit("data-changed", data).map_err(|e| e.to_string()) }
pub fn preset(kind: &str, size: &str) -> Result<(f64, f64), String> {
    match (kind, size) {
        ("calendar", "small") => Ok((280., 340.)), ("calendar", "medium") => Ok((320., 380.)), ("calendar", "large") => Ok((420., 460.)),
        ("focus", "small") => Ok((280., 240.)), ("focus", "medium") => Ok((320., 320.)), ("focus", "large") => Ok((380., 400.)),
        ("note", "small") => Ok((280., 220.)), ("note", "medium") => Ok((320., 300.)), ("note", "large") => Ok((420., 440.)),
        ("weather", "small") => Ok((260., 150.)), ("weather", "medium") => Ok((320., 180.)), ("weather", "large") => Ok((380., 240.)),
        _ => Err("不支持的挂件尺寸".into())
    }
}
fn minimum(kind: &str) -> (f64, f64) { match kind { "calendar" => (260., 300.), "note" => (250., 210.), "focus" => (260., 220.), _ => (260., 150.) } }

#[tauri::command]
pub fn begin_widget_gesture(app: AppHandle, window: WebviewWindow, mode: String, grab_x: f64, grab_y: f64) -> Result<(), String> {
    let kind = kind_for(&window)?;
    if !["move", "n", "ne", "e", "se", "s", "sw", "w", "nw"].contains(&mode.as_str()) { return Err("无效操作".into()); }
    let data = db::read_db()?;
    if data["settings"]["mini_widgets"][kind]["locked"].as_bool().unwrap_or(false) { return Err("请先解锁挂件位置".into()); }
    let rect = window_rect(&window)?;
    let client_origin = window.inner_position().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    if !grab_x.is_finite() || !grab_y.is_finite() || grab_x < 0. || grab_y < 0. || grab_x * scale > rect.width as f64 || grab_y * scale > rect.height as f64 { return Err("无效的拖动起点".into()); }
    let mut peers = Vec::new();
    for peer_kind in window_custom::MINI_WIDGET_KINDS {
        if peer_kind == kind { continue; }
        if let Some(peer) = app.get_webview_window(&format!("mini-{peer_kind}")) { if peer.is_visible().unwrap_or(false) { if let Ok(r) = window_rect(&peer) { peers.push(r); } } }
    }
    gestures().lock().unwrap_or_else(|p| p.into_inner()).insert(kind.into(), Gesture { rect, cursor: (client_origin.x + (grab_x * scale).round() as i32, client_origin.y + (grab_y * scale).round() as i32), scale, mode, peers });
    Ok(())
}

#[tauri::command]
pub fn update_widget_gesture(window: WebviewWindow) -> Result<Value, String> {
    let kind = kind_for(&window)?;
    let state = gestures().lock().unwrap_or_else(|p| p.into_inner()).get(kind).cloned().ok_or("拖动已结束")?;
    let point = cursor()?; let (dx, dy) = (point.0 - state.cursor.0, point.1 - state.cursor.1);
    let area = area_at(&window, if state.mode == "move" { point } else { (state.rect.x + state.rect.width / 2, state.rect.y + state.rect.height / 2) })?;
    let scale = if state.mode == "move" { scale_at(&window, point)? } else { window.scale_factor().map_err(|e| e.to_string())? };
    let alt = unsafe { windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(0x12) } < 0;
    let (rect, x, y) = if state.mode == "move" {
        let ratio = scale / state.scale;
        let r = widget_geometry::contain(Rect { x: point.0 - ((state.cursor.0 - state.rect.x) as f64 * ratio).round() as i32,
            y: point.1 - ((state.cursor.1 - state.rect.y) as f64 * ratio).round() as i32,
            width: (state.rect.width as f64 * ratio).round() as i32, height: (state.rect.height as f64 * ratio).round() as i32 }, area);
        if alt { (r, None, None) } else { widget_geometry::snap(r, area, &state.peers, (8. * scale).round() as i32, (16. * scale).round() as i32) }
    } else {
        let m = minimum(kind);
        let minimum = ((m.0 * scale).round() as i32, (m.1 * scale).round() as i32);
        let r = widget_geometry::resize(widget_geometry::contain(state.rect, area), &state.mode, dx, dy, minimum, area);
        if alt { (r, None, None) } else { widget_geometry::snap_resize(r, &state.mode, area, &state.peers, (8. * scale).round() as i32, (16. * scale).round() as i32, minimum) }
    };
    if state.mode == "move" {
        let current = window.inner_size().map_err(|e| e.to_string())?;
        if current.width != rect.width as u32 || current.height != rect.height as u32 { window.set_size(PhysicalSize::new(rect.width as u32, rect.height as u32)).map_err(|e| e.to_string())?; }
        window.set_position(PhysicalPosition::new(rect.x, rect.y)).map_err(|e| e.to_string())?;
    }
    else { apply_rect(&window, rect)?; }
    Ok(json!({"x": x.map(|v| (v - rect.x) as f64 / scale), "y": y.map(|v| (v - rect.y) as f64 / scale), "width": (rect.width as f64 / scale).round(), "height": (rect.height as f64 / scale).round()}))
}

#[tauri::command]
pub fn end_widget_gesture(window: WebviewWindow, cancel: bool) -> Result<(), String> {
    let kind = kind_for(&window)?;
    let state = gestures().lock().unwrap_or_else(|p| p.into_inner()).remove(kind);
    if let Some(state) = state {
        if cancel { apply_rect(&window, state.rect)?; }
        else { undo().lock().unwrap_or_else(|p| p.into_inner()).insert(kind.into(), state.rect); }
    }
    persist(&window, kind)
}

#[tauri::command]
pub fn widget_action(app: AppHandle, window: WebviewWindow, kind: String, action: String) -> Result<(), String> {
    let label = window_custom::mini_widget_label(&kind)?;
    let target = app.get_webview_window(&label).ok_or("找不到挂件")?;
    if gestures().lock().unwrap_or_else(|p| p.into_inner()).contains_key(&kind) { return Err("请先结束当前拖动".into()); }
    let data = db::read_db()?;
    let state = &data["settings"]["mini_widgets"][&kind];
    match action.as_str() {
        "left" | "right" | "up" | "down" | "left-fast" | "right-fast" | "up-fast" | "down-fast" => {
            if state["locked"].as_bool().unwrap_or(false) { return Err("请先解锁挂件位置".into()); }
            let before = window_rect(&target)?; let mut rect = before;
            let step = ((if action.ends_with("-fast") { 10. } else { 1. }) * target.scale_factor().map_err(|e| e.to_string())?).round() as i32;
            if action.starts_with("left") { rect.x -= step; } if action.starts_with("right") { rect.x += step; }
            if action.starts_with("up") { rect.y -= step; } if action.starts_with("down") { rect.y += step; }
            let area = area_at(&target, (before.x + before.width / 2, before.y + before.height / 2))?;
            apply_rect(&target, widget_geometry::contain(rect, area))?;
            undo().lock().unwrap_or_else(|p| p.into_inner()).insert(kind.clone(), before);
            persist(&target, &kind)?;
        },
        "lock" | "top" => {
            let field = if action == "lock" { "locked" } else { "always_on_top" };
            let enabled = !state[field].as_bool().unwrap_or(false);
            if action == "lock" { target.set_resizable(!enabled).map_err(|e| e.to_string())?; }
            else { target.set_always_on_top(enabled).map_err(|e| e.to_string())?; }
            if let Err(error) = db::update_db(|d| { d["settings"]["mini_widgets"][&kind][field] = json!(enabled); ((), true) }) {
                if action == "lock" { let _ = target.set_resizable(enabled); } else { let _ = target.set_always_on_top(!enabled); } return Err(error);
            }
        },
        "small" | "medium" | "large" | "reset" | "rescue" | "undo" => {
            let before = window_rect(&target)?;
            let mut rect = before;
            let reference = if action == "rescue" || action == "reset" { window_rect(&window).unwrap_or(before) } else { before };
            let area = area_at(&target, (reference.x + reference.width / 2, reference.y + reference.height / 2))?;
            if ["small", "medium", "large", "reset"].contains(&action.as_str()) {
                let size = preset(&kind, if action == "reset" { "medium" } else { &action })?;
                let scale = scale_at(&target, (reference.x + reference.width / 2, reference.y + reference.height / 2))?;
                rect.width = (size.0 * scale).round() as i32; rect.height = (size.1 * scale).round() as i32;
            }
            if action == "rescue" || action == "reset" {
                let scale = target.scale_factor().map_err(|e| e.to_string())?;
                let slot = window_custom::MINI_WIDGET_KINDS.iter().position(|v| *v == kind).unwrap_or(0);
                rect.x = area.x + ((24 + slot % 2 * 336) as f64 * scale).round() as i32;
                rect.y = area.y + ((24 + slot / 2 * 396) as f64 * scale).round() as i32;
            }
            if action == "undo" { rect = *undo().lock().unwrap_or_else(|p| p.into_inner()).get(&kind).ok_or("暂无可撤销的布局操作")?; }
            let area = if action == "undo" { area_at(&target, (rect.x + rect.width / 2, rect.y + rect.height / 2))? } else { area };
            apply_rect(&target, widget_geometry::contain(rect, area))?;
            undo().lock().unwrap_or_else(|p| p.into_inner()).insert(kind.clone(), before);
            persist(&target, &kind)?;
            if action == "rescue" { target.show().map_err(|e| e.to_string())?; window_custom::persist_mini_widget_visibility(&kind, true)?; app.emit("widget-visibility-changed", json!({"kind": kind, "visible": true})).map_err(|e| e.to_string())?; }
        },
        _ => return Err("不支持的挂件操作".into())
    }
    publish(&app)
}

#[tauri::command]
pub fn save_widget_layout(app: AppHandle) -> Result<(), String> {
    for kind in window_custom::MINI_WIDGET_KINDS { if let Some(w) = app.get_webview_window(&format!("mini-{kind}")) { persist(&w, kind)?; } }
    db::update_db(|d| { d["widget_layout_snapshot"] = d["settings"]["mini_widgets"].clone(); ((), true) })?;
    Ok(())
}

#[tauri::command]
pub fn restore_widget_layout(app: AppHandle) -> Result<(), String> {
    if !gestures().lock().unwrap_or_else(|p| p.into_inner()).is_empty() { return Err("请先结束当前拖动".into()); }
    let data = db::read_db()?;
    let snapshot = data.get("widget_layout_snapshot").filter(|v| v.is_object()).ok_or("请先保存一套桌面布局")?.clone();
    db::update_db(|d| { d["settings"]["mini_widgets"] = snapshot; ((), true) })?;
    for kind in window_custom::MINI_WIDGET_KINDS {
        if let Some(w) = app.get_webview_window(&format!("mini-{kind}")) {
            window_custom::restore_mini_widget(kind, &w)?; window_custom::keep_widget_on_screen(&w)?;
            let visible = data["widget_layout_snapshot"][kind]["visible"].as_bool().unwrap_or(false);
            if !visible { w.hide().map_err(|e| e.to_string())?; }
            app.emit("widget-visibility-changed", json!({"kind": kind, "visible": visible})).map_err(|e| e.to_string())?;
        }
    }
    publish(&app)
}
