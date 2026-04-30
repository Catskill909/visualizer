#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::api::dialog::FileDialogBuilder;
use tauri::async_runtime::channel;
use base64::{engine::general_purpose, Engine as _};

struct CaffeinateState(Mutex<Option<Child>>);


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

#[derive(serde::Serialize)]
struct AudioFileResult {
    name: String,
    data: String,
}

#[tauri::command]
async fn pick_audio_file() -> Option<AudioFileResult> {
    let (tx, mut rx) = channel::<Option<std::path::PathBuf>>(1);
    FileDialogBuilder::new()
        .set_title("Open Audio File")
        .add_filter("Audio", &["mp3", "wav", "flac", "ogg", "aac", "m4a", "opus", "aiff", "aif"])
        .pick_file(move |path| {
            let _ = tx.blocking_send(path);
        });
    let path = rx.recv().await.unwrap_or(None)?;
    let name = path.file_name()?.to_string_lossy().into_owned();
    let bytes = std::fs::read(&path).ok()?;
    let data = general_purpose::STANDARD.encode(&bytes);
    Some(AudioFileResult { name, data })
}

fn main() {
    tauri::Builder::default()
        .manage(CaffeinateState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![caffeinate_start, caffeinate_stop, toggle_fullscreen, get_fullscreen, pick_audio_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
