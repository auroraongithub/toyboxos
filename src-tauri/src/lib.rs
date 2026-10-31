// Native shell for toybox.os: a system webview showing the bundled dist/. All app logic lives in the web code.
// Desktop only: closing the window hides it to the tray (so reminders and alarms keep ringing); "Quit" in the tray really quits.
// Desktop can also host the sync server for the user's other devices (host.rs).
#[cfg(desktop)]
mod host;
#[cfg(desktop)]
fn show_main(app: &tauri::AppHandle) {
  use tauri::Manager;
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
  }
}

/* web links (Get a key, job pages, citations) go to the system browser; only http(s)/mailto */
#[cfg(desktop)]
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
  let ok = ["http://", "https://", "mailto:"].iter().any(|p| url.to_ascii_lowercase().starts_with(p));
  if !ok || url.chars().any(|c| c.is_control() || c == '"') { return Err("not a web link".into()); }
  #[cfg(windows)]
  let r = { use std::os::windows::process::CommandExt; std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", &url]).creation_flags(0x0800_0000).spawn() };
  #[cfg(target_os = "macos")]
  let r = std::process::Command::new("open").arg(&url).spawn();
  #[cfg(all(unix, not(target_os = "macos")))]
  let r = std::process::Command::new("xdg-open").arg(&url).spawn();
  r.map(|_| ()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default();

  #[cfg(desktop)]
  let builder = builder
    .plugin(tauri_plugin_notification::init())
    .manage(host::Host(std::sync::Mutex::new(None)))
    .invoke_handler(tauri::generate_handler![host::host_status, host::host_set, open_url])
    .setup(|app| {
      host::resume(app.handle());
      use tauri::menu::{Menu, MenuItem};
      use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
      let show = MenuItem::with_id(app, "show", "Open toybox.os", true, None::<&str>)?;
      let quit = MenuItem::with_id(app, "quit", "Quit (reminders and hosted sync stop)", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&show, &quit])?;
      TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("toybox.os")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
          "show" => show_main(app),
          "quit" => app.exit(0),
          _ => {}
        })
        .on_tray_icon_event(|tray, e| {
          if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
            show_main(tray.app_handle());
          }
        })
        .build(app)?;
      Ok(())
    })
    .on_window_event(|w, e| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = e {
        let _ = w.hide();
        api.prevent_close();
      }
    });

  builder
    .build(tauri::generate_context!())
    .expect("error while running toybox.os")
    .run(|_app, _e| {
      // the hosted server stops with the app
      #[cfg(desktop)]
      if let tauri::RunEvent::Exit = _e {
        use tauri::Manager;
        host::stop(&_app.state::<host::Host>());
      }
    });
}
