#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::api::dialog::FileDialogBuilder;
use tauri::api::process::{Command as TauriCommand, CommandEvent};
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

fn parse_ffmpeg_time(line: &str) -> Option<f64> {
    let idx = line.find("time=")?;
    let rest = &line[idx + 5..];
    let time_str = rest.split_whitespace().next()?;
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() == 3 {
        let h: f64 = parts[0].parse().ok()?;
        let m: f64 = parts[1].parse().ok()?;
        let s: f64 = parts[2].parse().ok()?;
        return Some(h * 3600.0 + m * 60.0 + s);
    }
    None
}

#[tauri::command]
async fn convert_to_stacked_alpha(window: tauri::Window, input_path: String) -> Result<String, String> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let output_path = std::env::temp_dir().join(format!("stacked_{}.webm", timestamp));
    let output_path_str = output_path.to_string_lossy().into_owned();

    let cmd = TauriCommand::new_sidecar("ffmpeg")
        .map_err(|e| format!("sidecar lookup failed: {}", e))?
        .args([
            "-y",
            "-hide_banner",
            "-loglevel", "error",
            "-stats",
            "-c:v", "libvpx-vp9",
            "-i", &input_path,
            "-filter_complex",
            "[0:v]format=yuva420p,split=2[a][b];[a]alphaextract,format=gray[alpha];[b]format=yuv420p[rgb];[rgb][alpha]vstack[stacked]",
            "-map", "[stacked]",
            "-c:v", "libvpx-vp9",
            "-pix_fmt", "yuv420p",
            "-b:v", "2M",
            "-an",
            &output_path_str,
        ]);

    let (mut rx, _child) = cmd.spawn().map_err(|e| format!("spawn failed: {}", e))?;

    let mut stderr_log = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(line) => {
                if let Some(t) = parse_ffmpeg_time(&line) {
                    let _ = window.emit("webm-convert-progress", t);
                }
                stderr_log.push_str(&line);
                stderr_log.push('\n');
            }
            CommandEvent::Error(e) => {
                let _ = std::fs::remove_file(&output_path);
                return Err(format!("ffmpeg error: {}\nstderr:\n{}", e, stderr_log));
            }
            CommandEvent::Terminated(payload) => {
                if payload.code != Some(0) {
                    let _ = std::fs::remove_file(&output_path);
                    return Err(format!(
                        "ffmpeg exited code={:?} signal={:?}\nstderr:\n{}",
                        payload.code, payload.signal, stderr_log
                    ));
                }
                break;
            }
            _ => {}
        }
    }

    let bytes = std::fs::read(&output_path)
        .map_err(|e| format!("read output failed: {}", e))?;
    let debug_copy = std::env::temp_dir().join("discocast_last_stacked.webm");
    let _ = std::fs::copy(&output_path, &debug_copy);
    eprintln!("[convert_to_stacked_alpha] debug copy at {}", debug_copy.display());
    let _ = std::fs::remove_file(&output_path);
    Ok(general_purpose::STANDARD.encode(&bytes))
}

#[tauri::command]
async fn convert_to_stacked_alpha_b64(window: tauri::Window, input_b64: String) -> Result<String, String> {
    let bytes = general_purpose::STANDARD
        .decode(&input_b64)
        .map_err(|e| format!("decode input failed: {}", e))?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let input_path = std::env::temp_dir().join(format!("stacked_in_{}.webm", timestamp));
    std::fs::write(&input_path, &bytes).map_err(|e| format!("write input failed: {}", e))?;
    let result = convert_to_stacked_alpha(window, input_path.to_string_lossy().into_owned()).await;
    let _ = std::fs::remove_file(&input_path);
    result
}

fn main() {
    tauri::Builder::default()
        .manage(CaffeinateState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![caffeinate_start, caffeinate_stop, toggle_fullscreen, get_fullscreen, pick_audio_file, pick_image_file, save_file, store_blob, get_blob, delete_blob, convert_to_stacked_alpha, convert_to_stacked_alpha_b64])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
