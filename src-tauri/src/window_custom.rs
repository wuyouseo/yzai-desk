use std::collections::HashMap;
use std::sync::{mpsc, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
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
                    let result = persist_mini_widget_geometry(&update.key, update.position, update.size);
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
        })
        .or_insert(update);
}

pub fn queue_mini_widget_geometry(
    kind: &str,
    position: Option<PhysicalPosition<i32>>,
    size: Option<PhysicalSize<u32>>,
) {
    let _ = geometry_sender().send(GeometryUpdate {
        key: kind.to_string(),
        position,
        size,
    });
}

pub fn persist_mini_widget_geometry(
    kind: &str,
    position: Option<PhysicalPosition<i32>>,
    size: Option<PhysicalSize<u32>>,
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
        ((), position.is_some() || size.is_some())
    })
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
    let data = db::read_db();
    let state = data
        .get("settings")
        .and_then(|value| value.get("mini_widgets"))
        .and_then(|value| value.get(kind));

    if let Some(position) = state.and_then(|value| value.get("position")) {
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

    if state
        .and_then(|value| value.get("visible"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        window.show().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn configure_mini_widget_window(kind: &str, window: &WebviewWindow) -> Result<(), String> {
    restore_mini_widget(kind, window)?;
    let window_clone = window.clone();
    let kind_owned = kind.to_string();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window_clone.hide();
            let _ = persist_mini_widget_visibility(&kind_owned, false);
        }
        tauri::WindowEvent::Moved(position) => {
            queue_mini_widget_geometry(&kind_owned, Some(*position), None);
        }
        tauri::WindowEvent::Resized(size) => {
            queue_mini_widget_geometry(&kind_owned, None, Some(*size));
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
    window.show().map_err(|error| error.to_string())?;
    // Windows can reject focus stealing when the request comes from Explorer's
    // context menu. The widget is already visible, so focus is best-effort and
    // must not turn a successful Add action into an error.
    let _ = window.set_focus();
    persist_mini_widget_visibility(kind, true)?;
    Ok(true)
}

pub fn hide_mini_widget_by_kind(app: &AppHandle, kind: &str) -> Result<bool, String> {
    let label = mini_widget_label(kind)?;
    if let Some(window) = app.get_webview_window(&label) {
        window.hide().map_err(|error| error.to_string())?;
    }
    persist_mini_widget_visibility(kind, false)?;
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
    window.start_dragging().map_err(|error| error.to_string())
}
