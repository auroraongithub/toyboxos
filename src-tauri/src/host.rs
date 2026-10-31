// "Host sync on this computer": runs the bundled sync server (server/package.py --sidecar, shipped as a resource folder)
// with its data in the app's data folder. It runs while the app is open or in the tray and starts again with the app
// while the switch is on (a host-on file). The web side reads the token from here to connect this device to it.
use std::{fs, path::PathBuf, process::{Child, Command}, sync::Mutex};
use tauri::{AppHandle, Manager, State};

pub const PORT: u16 = 8787;
pub struct Host(pub Mutex<Option<Child>>);

#[derive(serde::Serialize)]
pub struct Status { available: bool, on: bool, running: bool, port: u16, token: String, err: String }

fn home(app: &AppHandle) -> Option<PathBuf> { app.path().app_data_dir().ok().map(|d| d.join("server")) }
fn exe(app: &AppHandle) -> Option<PathBuf> {
  let name = if cfg!(windows) { "toybox-server.exe" } else { "toybox-server" };
  let p = app.path().resource_dir().ok()?.join("server").join("toybox-server").join(name);
  p.exists().then_some(p)
}
fn flag(app: &AppHandle) -> Option<PathBuf> { home(app).map(|h| h.join("host-on")) }

fn alive(g: &mut Option<Child>) -> bool {
  match g.as_mut().map(|c| c.try_wait()) { Some(Ok(None)) => true, _ => { *g = None; false } }
}

pub fn start(app: &AppHandle, st: &Host) -> Result<(), String> {
  let mut g = st.0.lock().unwrap();
  if alive(&mut g) { return Ok(()); }
  let exe = exe(app).ok_or("This install has no sync server built in.")?;
  let home = home(app).ok_or("No data folder.")?;
  fs::create_dir_all(&home).map_err(|e| e.to_string())?;
  let mut c = Command::new(exe);
  c.env("SOS_HOME", &home).args(["--quiet", "--port", &PORT.to_string()]).current_dir(&home);
  #[cfg(windows)]
  { use std::os::windows::process::CommandExt; c.creation_flags(0x0800_0000); } // no console window
  *g = Some(c.spawn().map_err(|e| format!("Couldn't start the server: {e}"))?);
  Ok(())
}

pub fn stop(st: &Host) {
  if let Some(mut c) = st.0.lock().unwrap().take() { let _ = c.kill(); let _ = c.wait(); }
}

/// at app start: bring the server back if the switch was left on
pub fn resume(app: &AppHandle) {
  if flag(app).is_some_and(|f| f.exists()) { let _ = start(app, &app.state::<Host>()); }
}

fn status(app: &AppHandle, st: &Host, err: String) -> Status {
  let running = alive(&mut st.0.lock().unwrap());
  let token = if running { home(app).and_then(|h| fs::read_to_string(h.join("token.txt")).ok()).unwrap_or_default().trim().to_string() } else { String::new() };
  Status { available: exe(app).is_some(), on: flag(app).is_some_and(|f| f.exists()), running, port: PORT, token, err }
}

#[tauri::command]
pub fn host_status(app: AppHandle, st: State<Host>) -> Status {
  // the switch is on but the server died: start it again
  let mut err = String::new();
  if flag(&app).is_some_and(|f| f.exists()) && !alive(&mut st.0.lock().unwrap()) {
    if let Err(e) = start(&app, &st) { err = e; }
  }
  status(&app, &st, err)
}

#[tauri::command]
pub fn host_set(app: AppHandle, st: State<Host>, on: bool) -> Status {
  let mut err = String::new();
  if let Some(f) = flag(&app) {
    if on {
      if let Some(h) = home(&app) { let _ = fs::create_dir_all(h); }
      match start(&app, &st) { Ok(()) => { let _ = fs::write(f, b"1"); } Err(e) => err = e }
    } else {
      let _ = fs::remove_file(f);
      stop(&st);
    }
  }
  status(&app, &st, err)
}
