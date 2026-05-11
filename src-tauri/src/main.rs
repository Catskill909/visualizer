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

#[derive(serde::Serialize)]
struct BlobResult {
    data: String,  // base64-encoded bytes
    mime: String,  // mime type string
}

#[tauri::command]
async fn store_blob(app: tauri::AppHandle, image_id: String, data: String, mime: String) -> Result<(), String> {
    let data_dir = app.path_resolver().app_data_dir()
        .ok_or_else(|| "Could not resolve app data dir".to_string())?;
    let images_dir = data_dir.join("images");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    let bytes = general_purpose::STANDARD.decode(&data).map_err(|e| e.to_string())?;
    std::fs::write(images_dir.join(&image_id), bytes).map_err(|e| e.to_string())?;
    std::fs::write(images_dir.join(format!("{}.mime", &image_id)), mime.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_blob(app: tauri::AppHandle, image_id: String) -> Result<Option<BlobResult>, String> {
    let data_dir = app.path_resolver().app_data_dir()
        .ok_or_else(|| "Could not resolve app data dir".to_string())?;
    let images_dir = data_dir.join("images");
    let blob_path = images_dir.join(&image_id);
    if !blob_path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&blob_path).map_err(|e| e.to_string())?;
    let data = general_purpose::STANDARD.encode(&bytes);
    let mime_path = images_dir.join(format!("{}.mime", &image_id));
    let mime = if mime_path.exists() {
        std::fs::read_to_string(&mime_path).unwrap_or_default()
    } else {
        String::new()
    };
    Ok(Some(BlobResult { data, mime }))
}

#[tauri::command]
async fn delete_blob(app: tauri::AppHandle, image_id: String) -> Result<(), String> {
    let data_dir = app.path_resolver().app_data_dir()
        .ok_or_else(|| "Could not resolve app data dir".to_string())?;
    let images_dir = data_dir.join("images");
    let blob_path = images_dir.join(&image_id);
    if blob_path.exists() {
        std::fs::remove_file(&blob_path).map_err(|e| e.to_string())?;
    }
    let mime_path = images_dir.join(format!("{}.mime", &image_id));
    if mime_path.exists() {
        std::fs::remove_file(&mime_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn save_file(filename: String, content: String) -> Result<Option<String>, String> {
    let (tx, mut rx) = channel::<Option<std::path::PathBuf>>(1);
    FileDialogBuilder::new()
        .set_title("Save File")
        .set_file_name(&filename)
        .save_file(move |path| {
            let _ = tx.blocking_send(path);
        });
    let path = match rx.recv().await.unwrap_or(None) {
        Some(p) => p,
        None => return Ok(None), // user cancelled
    };
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
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

#[tauri::command]
async fn pick_image_file() -> Option<AudioFileResult> {
    let (tx, mut rx) = channel::<Option<std::path::PathBuf>>(1);
    FileDialogBuilder::new()
        .set_title("Open Image or Video")
        .add_filter("Images & Videos", &["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "mp4", "webm", "mov"])
        .add_filter("Images", &["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"])
        .add_filter("Videos", &["mp4", "webm", "mov"])
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
        .invoke_handler(tauri::generate_handler![caffeinate_start, caffeinate_stop, toggle_fullscreen, get_fullscreen, pick_audio_file, pick_image_file, save_file, store_blob, get_blob, delete_blob])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
