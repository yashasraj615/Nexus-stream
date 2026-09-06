#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::io::AsRawFd;
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent};

const PORT: u16 = 3615;

struct DesktopState {
  server: Mutex<Option<Child>>,
  tunnel: Mutex<Option<Child>>,
  tunnel_url: Mutex<Option<String>>,
  caffeinate: Mutex<Option<Child>>,
  log_path: PathBuf,
  root: PathBuf,
  _lock: File,
}

fn project_root() -> PathBuf {
  if let Ok(root) = std::env::var("NEXUS_ROOT") {
    return PathBuf::from(root);
  }
  PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .map(PathBuf::from)
    .unwrap_or_else(|| PathBuf::from("."))
}

fn app_support_dir() -> PathBuf {
  let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
  PathBuf::from(home).join("Library/Application Support/Nexus Stream")
}

fn runtime_dir() -> PathBuf {
  if let Some(bundle) = bundle_dir() {
    let resource = bundle.join("Contents").join("Resources");
    for candidate in [resource.join("runtime"), resource.clone()] {
      if candidate.join("server.mjs").exists() {
        return candidate;
      }
    }
    return resource.join("runtime");
  }
  project_root()
}

fn bundle_dir() -> Option<PathBuf> {
  let exe = std::env::current_exe().ok()?;
  let macos = exe.parent()?;
  if macos.file_name()?.to_str()? != "MacOS" {
    return None;
  }
  let contents = macos.parent()?;
  let app = contents.parent()?;
  if app.extension().and_then(|s| s.to_str()) == Some("app") {
    Some(app.to_path_buf())
  } else {
    None
  }
}

fn kill_other_desktop_instances() {
  let self_pid = std::process::id().to_string();
  let Ok(output) = Command::new("pgrep")
    .args(["-f", "nexus-stream-desktop"])
    .output()
  else {
    return;
  };
  for pid in String::from_utf8_lossy(&output.stdout).split_whitespace() {
    if pid != self_pid {
      let _ = Command::new("kill").arg(pid).status();
    }
  }
  thread::sleep(Duration::from_millis(250));
  let Ok(output) = Command::new("pgrep")
    .args(["-f", "nexus-stream-desktop"])
    .output()
  else {
    return;
  };
  for pid in String::from_utf8_lossy(&output.stdout).split_whitespace() {
    if pid != self_pid {
      let _ = Command::new("kill").args(["-9", pid]).status();
    }
  }
}

fn relocate_from_volume() -> bool {
  let Some(bundle) = bundle_dir() else {
    return false;
  };
  if !bundle.to_string_lossy().starts_with("/Volumes/") {
    return false;
  }
  let dest = PathBuf::from("/Applications/Nexus Stream.app");
  notify("Nexus Stream", "Installing to Applications…");
  kill_other_desktop_instances();
  if dest.exists() {
    let _ = Command::new("/bin/rm")
      .args(["-rf", dest.to_str().unwrap_or_default()])
      .status();
  }
  let copied = Command::new("/usr/bin/ditto")
    .arg(&bundle)
    .arg(&dest)
    .status()
    .map(|status| status.success())
    .unwrap_or(false);
  if !copied {
    notify(
      "Nexus Stream",
      "Could not copy to Applications. Drag the app there, then eject this disk.",
    );
    return false;
  }
  let _ = Command::new("open").arg(&dest).spawn();
  true
}

fn watch_bundle_alive(app: &AppHandle) {
  let Some(bundle) = bundle_dir() else {
    return;
  };
  let handle = app.clone();
  thread::spawn(move || {
    loop {
      thread::sleep(Duration::from_secs(2));
      let exe_gone = std::env::current_exe()
        .map(|path| !path.exists())
        .unwrap_or(false);
      if !bundle.exists() || exe_gone {
        handle.exit(0);
        return;
      }
    }
  });
}

fn enriched_path() -> String {
  let extra = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
  match std::env::var("PATH") {
    Ok(path) => format!("{extra}:{path}"),
    Err(_) => extra.to_string(),
  }
}

fn append_log(path: &PathBuf, line: &str) {
  if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
    let _ = writeln!(file, "{line}");
  }
}

fn notify(title: &str, message: &str) {
  let script = format!(
    r#"display notification "{}" with title "{}""#,
    message.replace('"', "'"),
    title.replace('"', "'")
  );
  let _ = Command::new("osascript").arg("-e").arg(script).status();
}

fn copy_text(text: &str) {
  if let Ok(mut proc) = Command::new("pbcopy").stdin(Stdio::piped()).spawn() {
    if let Some(stdin) = proc.stdin.as_mut() {
      let _ = stdin.write_all(text.as_bytes());
    }
    let _ = proc.wait();
  }
}

fn server_up() -> bool {
  ureq::get(&format!("http://127.0.0.1:{PORT}/api/health"))
    .timeout(Duration::from_millis(800))
    .call()
    .is_ok()
}

fn health_json() -> Option<serde_json::Value> {
  ureq::get(&format!("http://127.0.0.1:{PORT}/api/health"))
    .timeout(Duration::from_secs(2))
    .call()
    .ok()
    .and_then(|res| res.into_string().ok())
    .and_then(|body| serde_json::from_str(&body).ok())
}

fn listening_pids(port: u16) -> Vec<String> {
  Command::new("lsof")
    .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"])
    .output()
    .ok()
    .map(|output| {
      String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .map(str::to_string)
        .collect()
    })
    .unwrap_or_default()
}

fn kill_port(port: u16) {
  let pids = listening_pids(port);
  for pid in &pids {
    let _ = Command::new("kill").arg(pid).status();
  }
  if !pids.is_empty() {
    thread::sleep(Duration::from_millis(250));
  }
  for pid in listening_pids(port) {
    let _ = Command::new("kill").args(["-9", &pid]).status();
  }
}

fn acquire_lock(path: &PathBuf) -> Option<File> {
  let file = OpenOptions::new()
    .create(true)
    .read(true)
    .write(true)
    .open(path)
    .ok()?;
  let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
  if rc == 0 {
    Some(file)
  } else {
    None
  }
}

fn stop_process_tree(child: &mut Child) {
  let pid = child.id() as i32;
  unsafe {
    libc::killpg(pid, libc::SIGTERM);
  }
  thread::sleep(Duration::from_millis(200));
  let _ = child.kill();
  let _ = child.wait();
}

fn cloudflared_running() -> bool {
  Command::new("pgrep")
    .args(["-x", "cloudflared"])
    .status()
    .map(|status| status.success())
    .unwrap_or(false)
}

fn pipe_output(child: &mut Child, log_path: PathBuf, prefix: &'static str) {
  if let Some(stdout) = child.stdout.take() {
    let path = log_path.clone();
    thread::spawn(move || {
      for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        append_log(&path, &format!("[{prefix}] {line}"));
      }
    });
  }
  if let Some(stderr) = child.stderr.take() {
    thread::spawn(move || {
      for line in BufReader::new(stderr).lines().map_while(Result::ok) {
        append_log(&log_path, &format!("[{prefix}] {line}"));
      }
    });
  }
}

fn hold_awake(state: &DesktopState) {
  if let Some(mut previous) = state.caffeinate.lock().unwrap().take() {
    let _ = previous.kill();
    let _ = previous.wait();
  }
  let pid = std::process::id().to_string();
  match Command::new("caffeinate")
    .args(["-ims", "-w", &pid])
    .env("PATH", enriched_path())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
  {
    Ok(child) => {
      append_log(
        &state.log_path,
        &format!("[desktop] holding macOS idle-sleep assertion (caffeinate -ims -w {pid})"),
      );
      *state.caffeinate.lock().unwrap() = Some(child);
    }
    Err(err) => {
      append_log(
        &state.log_path,
        &format!("[desktop] caffeinate unavailable: {err}"),
      );
    }
  }
}

fn release_awake(state: &DesktopState) {
  if let Some(mut child) = state.caffeinate.lock().unwrap().take() {
    let _ = child.kill();
    let _ = child.wait();
  }
}

fn spawn_server(state: &DesktopState) -> Result<(), String> {
  if !listening_pids(PORT).is_empty() {
    append_log(
      &state.log_path,
      "[desktop] taking over :3615 so this app owns the host",
    );
    kill_port(PORT);
    thread::sleep(Duration::from_millis(400));
  }
  if cfg!(debug_assertions) {
    let mut cmd = Command::new("npm");
    cmd.args(["run", "dev"]);
    cmd
      .current_dir(&state.root)
      .env("PATH", enriched_path())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .process_group(0);
    let mut child = cmd
      .spawn()
      .map_err(|err| format!("Could not start npm: {err}"))?;
    pipe_output(&mut child, state.log_path.clone(), "server");
    *state.server.lock().unwrap() = Some(child);
    append_log(&state.log_path, "[desktop] started npm run dev");
    return Ok(());
  }

  let runtime = runtime_dir();
  let node = runtime.join("bin").join("node");
  let server = runtime.join("server.mjs");
  if !node.exists() || !server.exists() {
    return Err(
      "This copy of Nexus Stream is missing its built-in server. Install it from the DMG."
        .into(),
    );
  }
  let support = app_support_dir();
  let bin = runtime.join("bin");
  let _ = fs::create_dir_all(&support);
  let mut cmd = Command::new(&node);
  cmd
    .arg(&server)
    .current_dir(&runtime)
    .env("NODE_ENV", "production")
    .env("NEXUS_BUNDLED", "1")
    .env("NEXUS_RESOURCE_DIR", &runtime)
    .env("NEXUS_DATA_DIR", &support)
    .env("NEXUS_BIN_DIR", &bin)
    .env("PATH", format!("{}:{}", bin.display(), enriched_path()))
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .process_group(0);
  let mut child = cmd
    .spawn()
    .map_err(|err| format!("Could not start bundled server: {err}"))?;
  pipe_output(&mut child, state.log_path.clone(), "server");
  *state.server.lock().unwrap() = Some(child);
  append_log(
    &state.log_path,
    &format!("[desktop] started bundled server from {}", runtime.display()),
  );
  Ok(())
}

fn ensure_server(state: &DesktopState) -> Result<(), String> {
  {
    let server = state.server.lock().unwrap();
    if server.is_some() && server_up() {
      return Ok(());
    }
  }
  stop_owned_server(state);
  spawn_server(state)
}

fn restart_server(state: &DesktopState) -> Result<(), String> {
  stop_owned_server(state);
  kill_port(PORT);
  thread::sleep(Duration::from_millis(400));
  spawn_server(state)
}

fn stop_owned_server(state: &DesktopState) {
  if let Some(mut child) = state.server.lock().unwrap().take() {
    stop_process_tree(&mut child);
    kill_port(PORT);
    append_log(&state.log_path, "[desktop] stopped owned server");
  }
}

fn library_status() -> Option<serde_json::Value> {
  ureq::get(&format!("http://127.0.0.1:{PORT}/api/library/status"))
    .timeout(Duration::from_secs(2))
    .call()
    .ok()
    .and_then(|res| res.into_string().ok())
    .and_then(|body| serde_json::from_str(&body).ok())
}

fn scan_library(state: &DesktopState) {
  if let Err(err) = ensure_server(state) {
    notify("Nexus Stream", &err);
    return;
  }
  for _ in 0..40 {
    if server_up() {
      break;
    }
    thread::sleep(Duration::from_millis(250));
  }
  if !server_up() {
    notify("Nexus Stream", "Server is not ready to scan");
    return;
  }
  match ureq::post(&format!("http://127.0.0.1:{PORT}/api/library/rescan"))
    .timeout(Duration::from_secs(8))
    .call()
  {
    Ok(_) => {
      notify("Nexus Stream", "Scanning library for new content…");
      for _ in 0..180 {
        thread::sleep(Duration::from_secs(1));
        let Some(json) = library_status() else {
          continue;
        };
        match json.get("status").and_then(|v| v.as_str()).unwrap_or("") {
          "ready" => {
            let n = json.get("filesSeen").and_then(|v| v.as_u64()).unwrap_or(0);
            notify(
              "Nexus Stream",
              &format!("Library scan complete · {n} items"),
            );
            return;
          }
          "error" => {
            let msg = json
              .get("error")
              .and_then(|v| v.as_str())
              .unwrap_or("Scan failed");
            notify("Nexus Stream", msg);
            return;
          }
          _ => {}
        }
      }
      notify("Nexus Stream", "Scan is still running in the background");
    }
    Err(err) => notify("Nexus Stream", &format!("Could not start scan: {err}")),
  }
}

fn extract_tunnel_url(line: &str) -> Option<String> {
  let start = line.find("https://")?;
  let rest = &line[start..];
  let end = rest
    .find(|ch: char| ch.is_whitespace() || ch == '|' || ch == '"')
    .unwrap_or(rest.len());
  let url = rest[..end].trim().trim_end_matches('.').to_string();
  url.contains("trycloudflare.com").then_some(url)
}

fn start_tunnel(app: &AppHandle) -> Result<(), String> {
  let state = app.state::<Arc<DesktopState>>().inner().clone();
  if !server_up() {
    return Err("Start the server before opening a tunnel".into());
  }
  if cloudflared_running() {
    return Err("A Cloudflare tunnel is already running for :3615".into());
  }
  stop_owned_tunnel(app);
  let mut child = Command::new("cloudflared")
    .args([
      "tunnel",
      "--url",
      &format!("http://127.0.0.1:{PORT}"),
      "--no-autoupdate",
    ])
    .env("PATH", enriched_path())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|err| format!("cloudflared missing or failed: {err}"))?;
  append_log(&state.log_path, "[desktop] starting cloudflared quick tunnel");

  let handle = app.clone();
  let watcher = state.clone();
  if let Some(stderr) = child.stderr.take() {
    thread::spawn(move || {
      for line in BufReader::new(stderr).lines().map_while(Result::ok) {
        append_log(&watcher.log_path, &format!("[tunnel] {line}"));
        if let Some(url) = extract_tunnel_url(&line) {
          *watcher.tunnel_url.lock().unwrap() = Some(url.clone());
          copy_text(&url);
          notify("Nexus Stream tunnel", &format!("{url} (copied)"));
          refresh_menu_async(&handle);
        }
      }
    });
  }
  if let Some(stdout) = child.stdout.take() {
    let log_path = state.log_path.clone();
    thread::spawn(move || {
      for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        append_log(&log_path, &format!("[tunnel] {line}"));
      }
    });
  }
  *state.tunnel.lock().unwrap() = Some(child);
  Ok(())
}

fn stop_owned_tunnel(app: &AppHandle) {
  let state = app.state::<Arc<DesktopState>>();
  if let Some(mut child) = state.tunnel.lock().unwrap().take() {
    let _ = child.kill();
    let _ = child.wait();
    append_log(&state.log_path, "[desktop] owned quick tunnel stopped");
  }
  *state.tunnel_url.lock().unwrap() = None;
}

fn open_browser() {
  let _ = Command::new("open")
    .arg(format!("http://localhost:{PORT}"))
    .status();
}

fn open_admin() {
  let _ = Command::new("open")
    .arg(format!("http://localhost:{PORT}/admin"))
    .status();
}

fn show_logs(state: &DesktopState) {
  let _ = fs::create_dir_all(state.log_path.parent().unwrap_or(state.root.as_path()));
  if !state.log_path.exists() {
    append_log(&state.log_path, "[desktop] log created");
  }
  let _ = Command::new("open").arg(&state.log_path).status();
}

fn supabase_label() -> String {
  match health_json() {
    Some(json) => match json.get("supabase").and_then(|v| v.as_str()) {
      Some("ok") => "Supabase · online".into(),
      Some("unconfigured") => "Supabase · not configured".into(),
      Some(other) => format!("Supabase · {other}"),
      None => "Supabase · unknown".into(),
    },
    None => "Supabase · server offline".into(),
  }
}

fn server_label() -> String {
  if server_up() {
    "Server · running on :3615".into()
  } else {
    "Server · stopped".into()
  }
}

fn tunnel_label(app: &AppHandle) -> String {
  if app.state::<Arc<DesktopState>>().tunnel_url.lock().unwrap().is_some() {
    "Copy tunnel URL".into()
  } else if cloudflared_running() {
    "Cloudflare tunnel · already running".into()
  } else {
    "Start Cloudflare quick tunnel".into()
  }
}

fn owns_quick_tunnel(app: &AppHandle) -> bool {
  app
    .state::<Arc<DesktopState>>()
    .tunnel
    .lock()
    .unwrap()
    .is_some()
}

fn refresh_menu(app: &AppHandle) {
  let Ok(status) = MenuItemBuilder::with_id("status", server_label()).enabled(false).build(app) else {
    return;
  };
  let Ok(supabase) = MenuItemBuilder::with_id("supabase", supabase_label()).enabled(false).build(app) else {
    return;
  };
  let Ok(open) = MenuItemBuilder::with_id("open", "Open in browser").build(app) else {
    return;
  };
  let Ok(open_again) = MenuItemBuilder::with_id("open-again", "Open another browser window").build(app) else {
    return;
  };
  let Ok(admin) = MenuItemBuilder::with_id("admin", "Open Admin Panel").build(app) else {
    return;
  };
  let Ok(scan) = MenuItemBuilder::with_id("scan", "Scan library").build(app) else {
    return;
  };
  let Ok(restart) = MenuItemBuilder::with_id("restart", "Restart server").build(app) else {
    return;
  };
  let Ok(logs) = MenuItemBuilder::with_id("logs", "Show logs").build(app) else {
    return;
  };
  let tunnel_enabled = !cloudflared_running()
    || app
      .state::<Arc<DesktopState>>()
      .tunnel_url
      .lock()
      .unwrap()
      .is_some();
  let Ok(tunnel) = MenuItemBuilder::with_id("tunnel", tunnel_label(app))
    .enabled(tunnel_enabled)
    .build(app)
  else {
    return;
  };
  let Ok(stop_t) = MenuItemBuilder::with_id("stop-tunnel", "Stop quick tunnel")
    .enabled(owns_quick_tunnel(app))
    .build(app)
  else {
    return;
  };
  let Ok(quit) = MenuItemBuilder::with_id("quit", "Quit Nexus Stream").build(app) else {
    return;
  };
  let Ok(sep) = PredefinedMenuItem::separator(app) else {
    return;
  };
  if let Ok(menu) = MenuBuilder::new(app)
    .item(&status)
    .item(&sep)
    .item(&open)
    .item(&open_again)
    .item(&admin)
    .item(&scan)
    .item(&restart)
    .item(&logs)
    .item(&sep)
    .item(&supabase)
    .item(&tunnel)
    .item(&stop_t)
    .item(&sep)
    .item(&quit)
    .build()
  {
    if let Some(tray) = app.tray_by_id("main") {
      let _ = tray.set_menu(Some(menu));
      let _ = tray.set_tooltip(Some(server_label()));
    }
  }
}

fn refresh_menu_async(app: &AppHandle) {
  let handle = app.clone();
  let _ = handle.clone().run_on_main_thread(move || {
    refresh_menu(&handle);
  });
}

fn cleanup_children(state: &DesktopState) {
  release_awake(state);
  stop_owned_server(state);
  kill_port(PORT);
  append_log(&state.log_path, "[desktop] host stopped");
  // Leave Cloudflare tunnels running — they are independent of this tray app.
}

fn main() {
  let app = tauri::Builder::default()
    .setup(|app| {
      #[cfg(target_os = "macos")]
      app.set_activation_policy(tauri::ActivationPolicy::Accessory);

      if relocate_from_volume() {
        app.handle().exit(0);
        return Ok(());
      }

      let support = app_support_dir();
      let _ = fs::create_dir_all(&support);
      let log_path = support.join("desktop.log");
      let Some(lock) = acquire_lock(&support.join("desktop.lock")) else {
        open_browser();
        notify(
          "Nexus Stream",
          "Already running — opened in the browser",
        );
        app.handle().exit(0);
        return Ok(());
      };
      let state = Arc::new(DesktopState {
        server: Mutex::new(None),
        tunnel: Mutex::new(None),
        tunnel_url: Mutex::new(None),
        caffeinate: Mutex::new(None),
        log_path,
        root: if cfg!(debug_assertions) {
          project_root()
        } else {
          runtime_dir()
        },
        _lock: lock,
      });
      hold_awake(&state);
      if cloudflared_running() {
        append_log(
          &state.log_path,
          "[desktop] existing Cloudflare tunnel detected — will not start a second one",
        );
      }
      if let Err(err) = ensure_server(&state) {
        notify("Nexus Stream", &err);
      }
      app.manage(state);

      let icon = app
        .default_window_icon()
        .cloned()
        .unwrap_or(tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?);
      let placeholder = MenuBuilder::new(app).build()?;
      TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(false)
        .tooltip(server_label())
        .menu(&placeholder)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
          let state = app.state::<Arc<DesktopState>>();
          match event.id().as_ref() {
            "open" => open_browser(),
            "open-again" => open_browser(),
            "admin" => open_admin(),
            "scan" => {
              let owned = state.inner().clone();
              thread::spawn(move || scan_library(&owned));
            }
            "restart" => {
              match restart_server(&state) {
                Ok(()) => notify("Nexus Stream", "Server restarting on :3615"),
                Err(err) => notify("Nexus Stream", &err),
              }
              thread::sleep(Duration::from_millis(600));
              refresh_menu(app);
            }
            "logs" => show_logs(&state),
            "tunnel" => {
              let existing = state.tunnel_url.lock().unwrap().clone();
              if let Some(url) = existing {
                copy_text(&url);
                notify("Nexus Stream tunnel", &format!("{url} (copied)"));
              } else if cloudflared_running() {
                notify(
                  "Nexus Stream",
                  "Your Cloudflare tunnel is already pointing at localhost:3615",
                );
              } else if let Err(err) = start_tunnel(app) {
                notify("Nexus Stream", &err);
              }
              refresh_menu(app);
            }
            "stop-tunnel" => {
              stop_owned_tunnel(app);
              notify("Nexus Stream", "Quick tunnel stopped");
              refresh_menu(app);
            }
            "quit" => {
              cleanup_children(&state);
              app.exit(0);
            }
            _ => {}
          }
        })
        .build(app)?;

      let handle = app.handle().clone();
      refresh_menu(&handle);
      watch_bundle_alive(&handle);
      thread::spawn(move || {
        thread::sleep(Duration::from_secs(3));
        loop {
          if !server_up() {
            let state = handle.state::<Arc<DesktopState>>();
            append_log(&state.log_path, "[desktop] watchdog: server down, restarting");
            let _ = ensure_server(&state);
          }
          refresh_menu_async(&handle);
          thread::sleep(Duration::from_secs(8));
        }
      });
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("Nexus Stream desktop failed to start");

  app.run(|app, event| {
    if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
      if let Some(state) = app.try_state::<Arc<DesktopState>>() {
        cleanup_children(&state);
      }
    }
  });
}
