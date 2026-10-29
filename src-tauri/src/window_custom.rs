use std::collections::HashMap;
use std::sync::{mpsc, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use serde_json::{json, Value};
use crate::db;

pub const MINI_WIDGET_KINDS: [&str; 4] = ["calendar", "note", "focus", "weather"];

pub fn mini_widget_label(kind: &str) -> Result<String, String> {
    if MINI_WIDGET_KINDS.contains(&kind) {
        Ok(format!("mini-{kind}"))
    } else {
        Err(format!("不支持的桌面挂件类型：{kind}"))
    }
}

#[derive(Clone)]
struct GeometryUpdate {
    key: String,
    position: Option<PhysicalPosition<i32>>,
    size: Option<PhysicalSize<u32>>,
    placement: Option<Value>,
}

fn geometry_sender() -> &'static mpsc::Sender<GeometryUpdate> {
    static SENDER: OnceLock<mpsc::Sender<GeometryUpdate>> = OnceLock::new();
    SENDER.get_or_init(|| {
        let (sender, receiver) = mpsc::channel::<GeometryUpdate>();
        std::thread::spawn(move || {
            while let Ok(first) = receiver.recv() {
                let mut pending = HashMap::new();
                merge_geometry_update(&mut pending, first);
                while let Ok(update) = receiver.recv_timeout(Duration::from_millis(280)) {
                    merge_geometry_update(&mut pending, update);
                }
                for update in pending.into_values() {
                    let result = persist_mini_widget_geometry(&update.key, update.position, update.size, update.placement);
                    if let Err(error) = result {
                        eprintln!("Failed to persist widget geometry: {error}");
                    }
                }
            }
        });
        sender
    })
}

fn merge_geometry_update(
    pending: &mut HashMap<String, GeometryUpdate>,
    update: GeometryUpdate,
) {
    pending
        .entry(update.key.clone())
        .and_modify(|current| {
            if update.position.is_some() {
                current.position = update.position;
            }
            if update.size.is_some() {
                current.size = update.size;
            }
            if update.placement.is_some() { current.placement = update.placement.clone(); }
        })
        .or_insert(update);
}

pub fn queue_mini_widget_geometry(
    window: &WebviewWindow,
    kind: &str,
    position: Option<PhysicalPosition<i32>>,
    size: Option<PhysicalSize<u32>>,
) {
    let _ = geometry_sender().send(GeometryUpdate {
        key: kind.to_string(),
        position,
        size,
        placement: widget_placement(window).ok(),
    });
}

pub fn persist_mini_widget_geometry(
    kind: &str,
    position: Option<PhysicalPosition<i32>>,
    size: Option<PhysicalSize<u32>>,
    placement: Option<Value>,
) -> Result<(), String> {
    mini_widget_label(kind)?;
    db::update_db(|data| {
        if let Some(position) = position {
            data["settings"]["mini_widgets"][kind]["position"] = json!({
                "x": position.x,
                "y": position.y,
            });
        }
        if let Some(size) = size {
            data["settings"]["mini_widgets"][kind]["size"] = json!({
                "width": size.width,
                "height": size.height,
            });
        }
        if let Some(placement) = placement { data["settings"]["mini_widgets"][kind]["placement"] = placement; }
        ((), position.is_some() || size.is_some())
    })
}

pub fn widget_placement(window: &WebviewWindow) -> Result<Value, String> {
    let monitor = window.current_monitor().map_err(|e| e.to_string())?.ok_or("找不到挂件所在显示器")?;
    let area = monitor.work_area(); let scale = monitor.scale_factor();
    let p = window.outer_position().map_err(|e| e.to_string())?; let s = window.inner_size().map_err(|e| e.to_string())?;
    Ok(json!({"monitor": monitor.name(), "width": s.width as f64 / scale, "height": s.height as f64 / scale,
        "x": ((p.x - area.position.x) as f64 / (area.size.width.saturating_sub(s.width).max(1)) as f64).clamp(0., 1.),
        "y": ((p.y - area.position.y) as f64 / (area.size.height.saturating_sub(s.height).max(1)) as f64).clamp(0., 1.)}))
}

pub fn persist_mini_widget_visibility(kind: &str, visible: bool) -> Result<(), String> {
    mini_widget_label(kind)?;
    db::update_db(|data| {
        data["settings"]["mini_widgets"][kind]["visible"] = json!(visible);
        ((), true)
    })
}

pub fn restore_mini_widget(kind: &str, window: &WebviewWindow) -> Result<(), String> {
    mini_widget_label(kind)?;
    let data = db::read_db()?;
    let state = data
        .get("settings")
        .and_then(|value| value.get("mini_widgets"))
        .and_then(|value| value.get(kind));

    let placement = state.and_then(|v| v.get("placement"));
    if let Some(saved) = placement {
        let monitors = window.available_monitors().map_err(|e| e.to_string())?;
        let monitor = monitors.iter().find(|m| m.name().map(String::as_str) == saved["monitor"].as_str()).or_else(|| monitors.first());
        if let Some(m) = monitor {
            let a = m.work_area(); let scale = m.scale_factor();
            let size = window.inner_size().map_err(|e| e.to_string())?;
            let width = (saved["width"].as_f64().filter(|n| n.is_finite()).unwrap_or(size.width as f64 / scale).max(1.) * scale).round() as i32;
            let height = (saved["height"].as_f64().filter(|n| n.is_finite()).unwrap_or(size.height as f64 / scale).max(1.) * scale).round() as i32;
            let area = crate::widget_geometry::Rect { x: a.position.x, y: a.position.y, width: a.size.width as i32, height: a.size.height as i32 };
            let rect = crate::widget_geometry::contain(crate::widget_geometry::Rect { x: area.x + ((area.width - width).max(0) as f64 * saved["x"].as_f64().unwrap_or(0.).clamp(0., 1.)).round() as i32,
                y: area.y + ((area.height - height).max(0) as f64 * saved["y"].as_f64().unwrap_or(0.).clamp(0., 1.)).round() as i32, width, height }, area);
            window.set_size(PhysicalSize::new(rect.width as u32, rect.height as u32)).map_err(|e| e.to_string())?;
            window.set_position(PhysicalPosition::new(rect.x, rect.y)).map_err(|e| e.to_string())?;
        }
    }
    if placement.is_none() { if let Some(position) = state.and_then(|value| value.get("position")) {
        if let (Some(x), Some(y)) = (
            position.get("x").and_then(|value| value.as_i64()),
            position.get("y").and_then(|value| value.as_i64()),
        ) {
            window
                .set_position(PhysicalPosition::new(x as i32, y as i32))
                .map_err(|error| error.to_string())?;
        }
    }

    if let Some(size) = state.and_then(|value| value.get("size")) {
        if let (Some(width), Some(height)) = (
            size.get("width").and_then(|value| value.as_u64()),
            size.get("height").and_then(|value| value.as_u64()),
        ) {
            window
                .set_size(PhysicalSize::new(width.max(240) as u32, height.max(140) as u32))
                .map_err(|error| error.to_string())?;
        }
    }
    }
    window.set_resizable(!state.and_then(|v| v.get("locked")).and_then(|v| v.as_bool()).unwrap_or(false)).map_err(|e| e.to_string())?;
    window.set_always_on_top(state.and_then(|v| v.get("always_on_top")).and_then(|v| v.as_bool()).unwrap_or(false)).map_err(|e| e.to_string())?;

    if state
        .and_then(|value| value.get("visible"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        window.show().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn keep_widget_on_screen(window: &WebviewWindow) -> Result<(), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let visible = monitors.iter().find(|m| {
        let area = m.work_area();
        let x = i64::from(position.x); let y = i64::from(position.y);
        x + i64::from(size.width) / 2 >= i64::from(area.position.x) && x + i64::from(size.width) / 2 < i64::from(area.position.x) + i64::from(area.size.width)
            && y + i64::from(size.height) / 2 >= i64::from(area.position.y) && y + i64::from(size.height) / 2 < i64::from(area.position.y) + i64::from(area.size.height)
    });
    let monitor = visible.cloned().or(window.primary_monitor().map_err(|e| e.to_string())?).or_else(|| monitors.into_iter().next());
    if let Some(monitor) = monitor {
            let area = monitor.work_area();
            let rect = crate::widget_geometry::contain(crate::widget_geometry::Rect { x: position.x, y: position.y, width: size.width as i32, height: size.height as i32 }, crate::widget_geometry::Rect { x: area.position.x, y: area.position.y, width: area.size.width as i32, height: area.size.height as i32 });
            if rect.width != size.width as i32 || rect.height != size.height as i32 { window.set_size(PhysicalSize::new(rect.width as u32, rect.height as u32)).map_err(|e| e.to_string())?; }
            if rect.x != position.x || rect.y != position.y { window.set_position(PhysicalPosition::new(rect.x, rect.y)).map_err(|e| e.to_string())?; }
    }
    Ok(())
}

fn configure_mini_widget_window(kind: &str, window: &WebviewWindow) -> Result<(), String> {
    restore_mini_widget(kind, window)?;
    keep_widget_on_screen(window)?;
    let window_clone = window.clone();
    let kind_owned = kind.to_string();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window_clone.hide();
            let _ = persist_mini_widget_visibility(&kind_owned, false);
            let _ = window_clone.app_handle().emit("widget-visibility-changed", json!({ "kind": kind_owned, "visible": false }));
        }
        tauri::WindowEvent::Moved(position) => {
            queue_mini_widget_geometry(&window_clone, &kind_owned, Some(*position), None);
        }
        tauri::WindowEvent::Resized(size) => {
            if size.width > 0 && size.height > 0 { queue_mini_widget_geometry(&window_clone, &kind_owned, None, Some(*size)); }
        }
        tauri::WindowEvent::ScaleFactorChanged { .. } => {
            let _ = keep_widget_on_screen(&window_clone);
        }
        _ => {}
    });
    Ok(())
}

fn get_mini_widget_window(app: &AppHandle, kind: &str) -> Result<WebviewWindow, String> {
    let label = mini_widget_label(kind)?;
    app.get_webview_window(&label)
        .ok_or_else(|| format!("找不到{kind}桌面挂件窗口"))
}

pub fn configure_mini_widget_windows(app: &AppHandle) -> Result<(), String> {
    for kind in MINI_WIDGET_KINDS {
        let window = get_mini_widget_window(app, kind)?;
        configure_mini_widget_window(kind, &window)?;
    }
    Ok(())
}

pub fn show_mini_widget_by_kind(app: &AppHandle, kind: &str) -> Result<bool, String> {
    // The transparent WebView2 instances are declared in tauri.conf.json and
    // created before the settings UI is interactive. Showing a widget must not
    // synchronously build a WebView on Windows' UI thread.
    let window = get_mini_widget_window(app, kind)?;
    // A hidden widget may still be minimized after a display change. Restoring
    // it first makes both the settings button and the desktop menu deterministic.
    let _ = window.unminimize();
    keep_widget_on_screen(&window)?;
    window.show().map_err(|error| error.to_string())?;
    // Windows can reject focus stealing when the request comes from Explorer's
    // context menu. The widget is already visible, so focus is best-effort and
    // must not turn a successful Add action into an error.
    let _ = window.set_focus();
    persist_mini_widget_visibility(kind, true)?;
    let _ = app.emit("widget-visibility-changed", json!({ "kind": kind, "visible": true }));
    Ok(true)
}

pub fn hide_mini_widget_by_kind(app: &AppHandle, kind: &str) -> Result<bool, String> {
    let label = mini_widget_label(kind)?;
    if let Some(window) = app.get_webview_window(&label) {
        window.hide().map_err(|error| error.to_string())?;
    }
    persist_mini_widget_visibility(kind, false)?;
    let _ = app.emit("widget-visibility-changed", json!({ "kind": kind, "visible": false }));
    Ok(false)
}

#[tauri::command]
pub fn set_mini_widget_visibility(app: AppHandle, kind: String, visible: bool) -> Result<bool, String> {
    if visible {
        show_mini_widget_by_kind(&app, &kind)
    } else {
        hide_mini_widget_by_kind(&app, &kind)
    }
}

#[tauri::command]
pub fn toggle_mini_widget_visibility(app: AppHandle, kind: String) -> Result<bool, String> {
    let label = mini_widget_label(&kind)?;
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("找不到{kind}桌面挂件窗口"))?;
    let visible = window.is_visible().map_err(|error| error.to_string())?;
    if visible {
        hide_mini_widget_by_kind(&app, &kind)
    } else {
        show_mini_widget_by_kind(&app, &kind)
    }
}

#[tauri::command]
pub fn get_mini_widget_states(app: AppHandle) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    for kind in MINI_WIDGET_KINDS {
        let label = mini_widget_label(kind)?;
        let visible = app
            .get_webview_window(&label)
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false);
        result.insert(kind.to_string(), json!(visible));
    }
    Ok(Value::Object(result))
}

#[tauri::command]
pub fn show_settings_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("settings")
        .ok_or_else(|| "找不到配置中心窗口".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn start_window_drag(window: WebviewWindow) -> Result<(), String> {
    if let Some(kind) = window.label().strip_prefix("mini-") {
        if db::read_db()?["settings"]["mini_widgets"][kind]["locked"].as_bool().unwrap_or(false) { return Err("请先解锁挂件位置".into()); }
    }
    window.start_dragging().map_err(|error| error.to_string())
}
