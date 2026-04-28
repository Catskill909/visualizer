#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::process::{Child, Command};
use std::sync::Mutex;

struct CaffeinateState(Mutex<Option<Child>>);

fn clear_webkit_cache() {
    // WKWebView caches JS aggressively — wipe it on every launch so users
    // always run the latest bundled code after an app update.
    if let Some(home) = std::env::var_os("HOME") {
        let base = std::path::Path::new(&home);
        for subdir in &["Library/WebKit/app.discocast.visualizer",
                        "Library/Caches/app.discocast.visualizer"] {
            let path = base.join(subdir);
            if path.exists() {
                let _ = std::fs::remove_dir_all(&path);
            }
        }
    }
}

#[tauri::command]
fn get_fullscreen(window: tauri::Window) -> bool {
    window.is_fullscreen().unwrap_or(false)
}

#[tauri::command]
fn toggle_fullscreen(window: tauri::Window) {
    let current = window.is_fullscreen().unwrap_or(false);
    let _ = window.set_fullscreen(!current);
}

#[tauri::command]
fn caffeinate_start(state: tauri::State<CaffeinateState>) {
    let mut guard = state.0.lock().unwrap();
    if guard.is_none() {
        match Command::new("caffeinate").arg("-d").spawn() {
            Ok(child) => { *guard = Some(child); }
            Err(e) => { eprintln!("[DiscoCast] caffeinate spawn failed: {}", e); }
        }
    }
}

#[tauri::command]
fn caffeinate_stop(state: tauri::State<CaffeinateState>) {
    let mut guard = state.0.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
    }
}

fn main() {
    clear_webkit_cache();
    tauri::Builder::default()
        .manage(CaffeinateState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![caffeinate_start, caffeinate_stop, toggle_fullscreen, get_fullscreen])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
