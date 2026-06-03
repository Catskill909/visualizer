#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::api::dialog::FileDialogBuilder;
use tauri::api::process::{Command as TauriCommand, CommandChild, CommandEvent};
use tauri::async_runtime::channel;
use base64::{engine::general_purpose, Engine as _};

struct CaffeinateState(Mutex<Option<Child>>);

// Holds the running NDI sidecar (ndi-send). The app spawns it and relays JPEG
// frames to its stdin; libndi lives ONLY in the sidecar, never in the app binary
// (native-output-dev.md N0b, Rust-relay).
struct NdiState(Mutex<Option<CommandChild>>);

#[tauri::command]
fn ndi_start(window: tauri::Window, state: tauri::State<NdiState>, name: Option<String>) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if guard.is_some() {
        return Ok(()); // already running
    }
    let source_name = name
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "DiscoCast Program".to_string());
    let (mut rx, child) = TauriCommand::new_sidecar("ndi-send")
        .map_err(|e| format!("sidecar lookup failed: {}", e))?
        .args(["stream", &source_name])
        .spawn()
        .map_err(|e| format!("ndi-send spawn failed: {}", e))?;
    // Drain the sidecar's output so its pipe never fills; surface its fps/decode
    // logs to the webview as an "ndi-log" event.
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stderr(line) | CommandEvent::Stdout(line) => {
                    let _ = window.emit("ndi-log", line);
                }
                _ => {}
            }
        }
    });
    *guard = Some(child);
    Ok(())
}

#[tauri::command]
fn ndi_send_frame(state: tauri::State<NdiState>, frame_b64: String) -> Result<(), String> {
    let bytes = general_purpose::STANDARD
        .decode(&frame_b64)
        .map_err(|e| e.to_string())?;
    let mut guard = state.0.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        // length-prefixed (u32 LE) JPEG frame — matches the sidecar's stdin reader
        let mut buf = Vec::with_capacity(4 + bytes.len());
        buf.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        buf.extend_from_slice(&bytes);
        child.write(&buf).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("ndi not started".into())
    }
}

#[tauri::command]
fn ndi_stop(state: tauri::State<NdiState>) {
    let mut guard = state.0.lock().unwrap();
    if let Some(child) = guard.take() {
        let _ = child.kill();
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

// ── Phase B / B1 — fullscreen the app on a chosen monitor (Approach A) ──
#[derive(serde::Serialize)]
struct MonitorInfo {
    name: String,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    scale: f64,
    current: bool,
}

#[tauri::command]
fn list_monitors(window: tauri::Window) -> Vec<MonitorInfo> {
    let current_pos = window.current_monitor().ok().flatten().map(|m| *m.position());
    match window.available_monitors() {
        Ok(mons) => mons.iter().enumerate().map(|(i, m)| {
            let pos = m.position();
            let size = m.size();
            MonitorInfo {
                name: m.name().cloned().unwrap_or_else(|| format!("Display {}", i + 1)),
                x: pos.x,
                y: pos.y,
                w: size.width,
                h: size.height,
                scale: m.scale_factor(),
                current: current_pos.map_or(false, |c| c == *pos),
            }
        }).collect(),
        Err(_) => Vec::new(),
    }
}

#[tauri::command]
fn fullscreen_on_monitor(window: tauri::Window, x: i32, y: i32) -> Result<(), String> {
    // Exit any current fullscreen, move onto the target monitor, then fullscreen
    // there (Tauri #6394 approach). The window starts windowed, so the first call
    // is just move→fullscreen.
    let _ = window.set_fullscreen(false);
    window.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    window.set_fullscreen(true).map_err(|e| e.to_string())?;
    Ok(())
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

// ── Preset METADATA storage (Phase 4 — Tauri-FS mirror) ──────────────────────
// Eviction-proof native storage for custom-preset metadata records, mirroring the
// blob commands above (one directory over: app_data_dir/presets/<id>.json). On the
// desktop app the filesystem is authoritative for metadata because WKWebView/WebView2
// can evict IndexedDB under storage pressure. JSON is plain UTF-8 text (not base64).
// See milkdrop-pack-import.dev Phase 4.
#[tauri::command]
async fn store_preset(app: tauri::AppHandle, id: String, json: String) -> Result<(), String> {
    let data_dir = app.path_resolver().app_data_dir()
        .ok_or_else(|| "Could not resolve app data dir".to_string())?;
    let presets_dir = data_dir.join("presets");
    std::fs::create_dir_all(&presets_dir).map_err(|e| e.to_string())?;
    std::fs::write(presets_dir.join(format!("{}.json", &id)), json.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_all_presets(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let data_dir = app.path_resolver().app_data_dir()
        .ok_or_else(|| "Could not resolve app data dir".to_string())?;
    let presets_dir = data_dir.join("presets");
    if !presets_dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&presets_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Ok(text) = std::fs::read_to_string(&path) {
                out.push(text);
            }
        }
    }
    Ok(out)
}

#[tauri::command]
async fn delete_preset(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let data_dir = app.path_resolver().app_data_dir()
        .ok_or_else(|| "Could not resolve app data dir".to_string())?;
    let presets_dir = data_dir.join("presets");
    let preset_path = presets_dir.join(format!("{}.json", &id));
    if preset_path.exists() {
        std::fs::remove_file(&preset_path).map_err(|e| e.to_string())?;
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
    // Output as H.264 MP4, NOT VP9 WebM. In production WKWebView, VP9 video is
    // treated as cross-origin for pixel-extraction (drawImage→getImageData and
    // gl.texSubImage2D both throw SecurityError every frame). H.264 is treated
    // as same-origin and works fine. The stacked-alpha trick (RGB top half +
    // alpha-as-luma bottom half) is codec-agnostic — alpha is just visible
    // pixels — so it works identically in H.264.
    let output_path = std::env::temp_dir().join(format!("stacked_{}.mp4", timestamp));
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
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "20",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
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

    if !output_path.exists() {
        return Err(format!("ffmpeg reported success but output not found at {}", output_path.display()));
    }
    let bytes = std::fs::read(&output_path)
        .map_err(|e| format!("read output failed: {}", e))?;
    eprintln!("[convert_to_stacked_alpha] output at {} ({} bytes)", output_path.display(), bytes.len());
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
    // Input is still WebM (Sammie Roto export with VP9-alpha); only the OUTPUT codec changed.
    let input_path = std::env::temp_dir().join(format!("stacked_in_{}.webm", timestamp));
    std::fs::write(&input_path, &bytes).map_err(|e| format!("write input failed: {}", e))?;
    let result = convert_to_stacked_alpha(window, input_path.to_string_lossy().into_owned()).await;
    let _ = std::fs::remove_file(&input_path);
    result
}

fn main() {
    tauri::Builder::default()
        .manage(CaffeinateState(Mutex::new(None)))
        .manage(NdiState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![caffeinate_start, caffeinate_stop, toggle_fullscreen, get_fullscreen, list_monitors, fullscreen_on_monitor, pick_audio_file, pick_image_file, save_file, store_blob, get_blob, delete_blob, store_preset, get_all_presets, delete_preset, convert_to_stacked_alpha, convert_to_stacked_alpha_b64, ndi_start, ndi_send_frame, ndi_stop])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
