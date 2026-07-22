use tauri::{App, AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub fn setup_global_shortcut(app: &mut App) -> Result<(), String> {
    // Parse Alt+Space shortcut
    let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    
    // Register the shortcut
    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| e.to_string())?;
        
    Ok(())
}

pub fn handle_shortcut_trigger(app_handle: &AppHandle, shortcut: &Shortcut, event: &tauri_plugin_global_shortcut::ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }

    let target = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    
    if shortcut == &target {
        if let Some(panel) = app_handle.get_webview_window("quick-panel") {
            let is_visible = panel.is_visible().unwrap_or(false);
            if is_visible {
                let _ = panel.hide();
            } else {
                let _ = panel.show();
                let _ = panel.set_focus();
            }
        }
    }
}
