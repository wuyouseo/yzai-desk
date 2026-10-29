mod db;
mod data_merge;
mod data_secrets;
mod event_schedule;
mod startup;
mod clipboard;
mod alarm;
mod hotkey;
mod window_custom;
mod widget_geometry;
mod widget_controls;
mod desktop_integration;
mod system_fonts;
mod system_status;

use tauri::Manager;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{Menu, MenuItem};

fn show_settings_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        if window.is_minimized().unwrap_or(false) {
            let _ = window.unminimize();
        }
        if !window.is_visible().unwrap_or(false) {
            let _ = window.show();
        }
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_action = desktop_integration::requested_action();
    let safe_preview = cfg!(debug_assertions) && std::env::var_os("YZAI_SAFE_PREVIEW").is_some();
    // Reuse the existing process for both shell actions and ordinary launches.
    // This prevents duplicate clipboard listeners, alarm schedulers and writers.
    let launch_action = startup_action.as_deref().unwrap_or("settings");
    if !safe_preview && desktop_integration::forward_to_running_app(launch_action) {
        return;
    }

    // Initialize Database
    if let Err(error) = db::init_db() {
        eprintln!("Failed to initialize local database: {error}");
        #[cfg(windows)]
        unsafe {
            use std::os::windows::ffi::OsStrExt;
            let message: Vec<u16> = std::ffi::OsStr::new(&error).encode_wide().chain(Some(0)).collect();
            let title: Vec<u16> = std::ffi::OsStr::new("咏智桌面工具 - 数据读取失败").encode_wide().chain(Some(0)).collect();
            windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(0, message.as_ptr(), title.as_ptr(), 0x10);
        }
        return;
    }

    tauri::Builder::default()
        // Register tauri-plugin-global-shortcut
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    hotkey::handle_shortcut_trigger(app, shortcut, &event);
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let app_handle = app.handle().clone();

            if !safe_preview {
                if let Err(error) = desktop_integration::start_action_listener(app_handle.clone()) {
                    eprintln!("Failed to start desktop action listener: {}", error);
                }
                if let Err(error) = desktop_integration::register_desktop_context_menu() {
                    eprintln!("Failed to register desktop context menu: {}", error);
                }
                clipboard::start_clipboard_listener(app_handle.clone());
                alarm::start_alarm_scheduler(app_handle.clone());
                if let Err(error) = hotkey::setup_global_shortcut(app) {
                    eprintln!("Failed to register global hotkey: {}", error);
                }
            }

            // Configure Settings window to hide instead of closing
            if let Some(settings_win) = app.get_webview_window("settings") {
                let s_clone = settings_win.clone();
                settings_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = s_clone.hide();
                    }
                });
            }
            
            // Configure the pre-registered hidden widgets. Creating a transparent
            // WebView2 from a settings button can block the Windows UI thread.
            window_custom::configure_mini_widget_windows(&app_handle)?;
            
            // Configure Quick Panel: hide when focus is lost
            if let Some(panel_win) = app.get_webview_window("quick-panel") {
                let p_clone = panel_win.clone();
                let p_clone2 = panel_win.clone();
                panel_win.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::Focused(false) => {
                            let _ = p_clone.hide();
                        }
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            api.prevent_close();
                            let _ = p_clone2.hide();
                        }
                        _ => {}
                    }
                });
            }

            // Configure Notification window: hide on close
            if let Some(notif_win) = app.get_webview_window("notification") {
                let n_clone = notif_win.clone();
                notif_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = n_clone.hide();
                    }
                });
            }

            // Setup System Tray Icon
            let menu = Menu::with_items(app, &[
                &MenuItem::with_id(app, "show_settings", "打开配置中心", true, None::<&str>).unwrap(),
                &MenuItem::with_id(app, "exit", "退出", true, None::<&str>).unwrap(),
            ]).unwrap();
            
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .icon(app.default_window_icon().unwrap().clone()) // Use default app icon
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show_settings" => {
                            show_settings_window(app);
                        },
                        "exit" => {
                            app.exit(0);
                        },
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_settings_window(tray.app_handle());
                    }
                })
                .build(app)
                .map_err(|e| e.to_string())?;

            if let Some(settings) = app.get_webview_window("settings") {
                if matches!(startup_action.as_deref(), Some("background"))
                    || startup_action.as_deref().is_some_and(|action| action.starts_with("widget:"))
                {
                    let _ = settings.hide();
                } else {
                    let _ = settings.show();
                    let _ = settings.set_focus();
                }
            }
            desktop_integration::run_startup_action(&app_handle, startup_action.as_deref());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::get_data,
            db::save_data,
            db::restore_data,
            db::export_data,
            db::import_data,
            db::get_storage_info,
            db::set_storage_directory,
            db::choose_storage_directory,
            db::open_storage_directory,
            db::create_backup,
            db::export_note_text,
            db::export_ai_chat_markdown,
            startup::set_autostart,
            startup::get_autostart,
            clipboard::clean_paste,
            clipboard::clear_clipboard,
            alarm::set_pomo_duration,
            alarm::start_pomo,
            alarm::pause_pomo,
            alarm::stop_pomo,
            alarm::get_active_pomo,
            alarm::snooze_notification,
            alarm::hide_notification,
            alarm::notification_ready,
            window_custom::set_mini_widget_visibility,
            window_custom::toggle_mini_widget_visibility,
            window_custom::get_mini_widget_states,
            window_custom::show_settings_window,
            window_custom::start_window_drag,
            widget_controls::begin_widget_gesture,
            widget_controls::update_widget_gesture,
            widget_controls::end_widget_gesture,
            widget_controls::widget_action,
            widget_controls::save_widget_layout,
            widget_controls::restore_widget_layout,
            desktop_integration::install_desktop_context_menu,
            desktop_integration::remove_desktop_context_menu,
            system_fonts::get_system_fonts,
            system_status::get_process_memory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
