mod backend;
mod commands;
mod inference;
mod overlay;

use backend::{
    boot_backend, retire_legacy_satellite_task, reveal_main_window, should_hide_on_close,
    BackendManager, SetupStatus, SharedBackend, SharedStatus,
};
use std::sync::Arc;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tokio::sync::Mutex;

const OLLAMA_PORT: u16 = 11434;
const JARVIS_PORT: u16 = 18080;

#[cfg(windows)]
fn apply_windows_caption_color(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;

    let Ok(hwnd) = window.hwnd() else { return };
    let caption: u32 = 0x00261407; // #071426 in Windows COLORREF (BGR).
    let text: u32 = 0x00E6F1FF;
    unsafe {
        let _ = DwmSetWindowAttribute(hwnd.0, 35, &caption as *const _ as *const _, 4);
        let _ = DwmSetWindowAttribute(hwnd.0, 36, &text as *const _ as *const _, 4);
    }
}

#[cfg(target_os = "macos")]
use overlay::native_overlay;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend: SharedBackend = Arc::new(Mutex::new(BackendManager::default()));
    let status: SharedStatus = Arc::new(Mutex::new(SetupStatus::default()));

    let boot_backend_ref = backend.clone();
    let boot_status_ref = status.clone();

    tauri::Builder::default()
        .manage(backend.clone())
        .manage(status.clone())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = reveal_main_window(app);
        }))
        .setup(move |app| {
            retire_legacy_satellite_task();
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                apply_windows_caption_color(&window);
            }
            let _ = app.autolaunch().enable();
            if std::env::args().any(|arg| arg == "--hidden") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            // System tray
            let show = MenuItemBuilder::with_id("show", "Mostrar / ocultar Jarvis").build(app)?;
            let health = MenuItemBuilder::with_id("health", "Health: starting...")
                .enabled(false)
                .build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Salir de Jarvis").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show)
                .separator()
                .item(&health)
                .separator()
                .item(&quit)
                .build()?;

            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Jarvis")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = reveal_main_window(app);
                            }
                        }
                    }
                    "quit" => {
                        let backend = app.state::<SharedBackend>().inner().clone();
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            backend.lock().await.stop_all().await;
                            handle.exit(0);
                        });
                    }
                    _ => {}
                })
                .build(app)?;

            // Create native macOS overlay panel
            #[cfg(target_os = "macos")]
            unsafe {
                native_overlay::create(include_str!("overlay.html"), JARVIS_PORT);
            }

            // Register Cmd+Shift+Space to toggle the overlay
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };
                let sc = Shortcut::new(Some(Modifiers::META | Modifiers::SHIFT), Code::Space);
                if let Err(e) = app.global_shortcut().on_shortcut(sc, |_app, _sc, ev| {
                    if ev.state == ShortcutState::Pressed {
                        #[cfg(target_os = "macos")]
                        unsafe {
                            native_overlay::toggle();
                        }
                    }
                }) {
                    eprintln!("Warning: could not register Cmd+Shift+Space: {e}");
                }
            }

            // Auto-start backend services on launch
            tauri::async_runtime::spawn(boot_backend(boot_backend_ref, boot_status_ref));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_setup_status,
            commands::get_api_base,
            commands::start_backend,
            commands::stop_backend,
            commands::check_health,
            commands::fetch_energy,
            commands::fetch_telemetry,
            commands::fetch_traces,
            commands::fetch_trace,
            commands::fetch_learning_stats,
            commands::fetch_learning_policy,
            commands::fetch_memory_stats,
            commands::search_memory,
            commands::fetch_agents,
            commands::fetch_models,
            commands::run_jarvis_command,
            commands::fetch_savings,
            commands::submit_savings,
            commands::transcribe_audio,
            commands::speech_health,
            inference::pull_ollama_model,
            inference::delete_ollama_model,
            inference::save_cloud_key,
            inference::get_cloud_key_status,
            inference::list_provider_models,
            inference::apply_inference_config,
            inference::get_provider_statuses,
            inference::get_inference_source,
            inference::set_inference_source,
            backend::show_main_window,
            overlay::toggle_overlay,
            overlay::hide_overlay,
            overlay::get_overlay_conversation,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Jarvis Desktop")
        .run(move |app, event| match event {
            tauri::RunEvent::WindowEvent { label, event, .. } if should_hide_on_close(&label) => {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
            }
            tauri::RunEvent::ExitRequested { .. } => {
                let b = backend.clone();
                tauri::async_runtime::spawn(async move {
                    b.lock().await.stop_all().await;
                });
            }
            _ => {}
        });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
