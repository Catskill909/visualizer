//! N0 NDI spike / sidecar (native-output-dev.md §7).
//!
//! Three modes:
//!   ndi-spike selftest [secs]        animated BGRA pattern → NDI (proves the NDI path)
//!   ndi-spike pipe-selftest [secs]   pattern → JPEG-encode → JPEG-decode → NDI
//!                                     (proves the decode+swizzle path the app uses)
//!   ndi-spike stream [name]          read length-prefixed JPEG frames from stdin →
//!                                     decode → NDI (the PRODUCTION sidecar path)
//!
//! stdin frame protocol: repeat { u32 little-endian length, then that many JPEG bytes }.
//! EOF (or a partial frame) ends the stream cleanly.
//!
//! Minimal hand-rolled FFI to /usr/local/lib/libndi.dylib (no SDK headers); see
//! build.rs for the link + rpath. Struct layouts mirror Processing.NDI.structs.h.

use std::ffi::CString;
use std::io::{Read, Write};
use std::os::raw::{c_char, c_int, c_void};
use std::time::Instant;

// ─── NDI FFI ────────────────────────────────────────────────────────────────
#[repr(C)]
struct NdiSendCreate {
    p_ndi_name: *const c_char,
    p_groups: *const c_char,
    clock_video: bool,
    clock_audio: bool,
}
#[repr(C)]
struct NdiVideoFrameV2 {
    xres: c_int,
    yres: c_int,
    four_cc: c_int,
    frame_rate_n: c_int,
    frame_rate_d: c_int,
    picture_aspect_ratio: f32,
    frame_format_type: c_int,
    timecode: i64,
    p_data: *mut u8,
    line_stride_in_bytes: c_int,
    p_metadata: *const c_char,
    timestamp: i64,
}
extern "C" {
    fn NDIlib_initialize() -> bool;
    fn NDIlib_destroy();
    fn NDIlib_send_create(create: *const NdiSendCreate) -> *mut c_void;
    fn NDIlib_send_destroy(instance: *mut c_void);
    fn NDIlib_send_send_video_v2(instance: *mut c_void, frame: *const NdiVideoFrameV2);
}
const BGRA: c_int = 0x4152_4742;
const PROGRESSIVE: c_int = 1;
const SYNTHESIZE_TIMECODE: i64 = i64::MAX;

/// Owns one NDI sender. Keeps the name CString alive for its lifetime.
struct NdiSender {
    instance: *mut c_void,
    _name: CString,
    fps_n: c_int,
    fps_d: c_int,
}
impl NdiSender {
    fn new(name: &str, fps: (c_int, c_int), clock: bool) -> Option<Self> {
        unsafe {
            if !NDIlib_initialize() {
                return None;
            }
            let cname = CString::new(name).ok()?;
            let create = NdiSendCreate {
                p_ndi_name: cname.as_ptr(),
                p_groups: std::ptr::null(),
                clock_video: clock,
                clock_audio: false,
            };
            let instance = NDIlib_send_create(&create);
            if instance.is_null() {
                NDIlib_destroy();
                return None;
            }
            Some(NdiSender { instance, _name: cname, fps_n: fps.0, fps_d: fps.1 })
        }
    }
    /// Send one BGRA frame (data is `w*h*4` bytes, B,G,R,A order).
    fn send_bgra(&self, w: c_int, h: c_int, data: &mut [u8]) {
        let frame = NdiVideoFrameV2 {
            xres: w,
            yres: h,
            four_cc: BGRA,
            frame_rate_n: self.fps_n,
            frame_rate_d: self.fps_d,
            picture_aspect_ratio: 0.0,
            frame_format_type: PROGRESSIVE,
            timecode: SYNTHESIZE_TIMECODE,
            p_data: data.as_mut_ptr(),
            line_stride_in_bytes: w * 4,
            p_metadata: std::ptr::null(),
            timestamp: 0,
        };
        unsafe { NDIlib_send_send_video_v2(self.instance, &frame) };
    }
}
impl Drop for NdiSender {
    fn drop(&mut self) {
        unsafe {
            NDIlib_send_destroy(self.instance);
            NDIlib_destroy();
        }
    }
}

// ─── helpers ─────────────────────────────────────────────────────────────────
/// Animated BGRA test pattern.
fn fill_pattern(buf: &mut [u8], w: usize, h: usize, t: usize) {
    for y in 0..h {
        let row = y * w * 4;
        for x in 0..w {
            let i = row + x * 4;
            buf[i] = ((x + y + t * 2) & 0xff) as u8; // B
            buf[i + 1] = ((y + t / 2) & 0xff) as u8; // G
            buf[i + 2] = ((x + t) & 0xff) as u8;     // R
            buf[i + 3] = 255;
        }
    }
}

/// RGBA → BGRA in place (swap R and B).
fn rgba_to_bgra(buf: &mut [u8]) {
    for px in buf.chunks_exact_mut(4) {
        px.swap(0, 2);
    }
}

fn encode_jpeg_from_bgra(bgra: &[u8], w: u32, h: u32, quality: u8) -> Vec<u8> {
    // build an RGBA image then JPEG-encode (JPEG drops alpha)
    let mut rgba = bgra.to_vec();
    rgba_to_bgra(&mut rgba); // BGRA→RGBA (same swap)
    let img = image::RgbaImage::from_raw(w, h, rgba).unwrap();
    let mut out = std::io::Cursor::new(Vec::new());
    let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
    image::DynamicImage::ImageRgba8(img)
        .write_with_encoder(enc)
        .expect("jpeg encode");
    out.into_inner()
}

fn decode_jpeg_to_bgra(jpg: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    let img = image::load_from_memory_with_format(jpg, image::ImageFormat::Jpeg).ok()?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut buf = rgba.into_raw();
    rgba_to_bgra(&mut buf);
    Some((w, h, buf))
}

// ─── modes ───────────────────────────────────────────────────────────────────
fn run_selftest(secs: u64, encode_roundtrip: bool) {
    let (w, h) = (1280usize, 720usize);
    let label = if encode_roundtrip { "pipe-selftest (JPEG roundtrip)" } else { "selftest (raw BGRA)" };
    let sender = match NdiSender::new("DiscoCast Spike", (30, 1), true) {
        Some(s) => s,
        None => { eprintln!("NDI init/create failed"); std::process::exit(1); }
    };
    println!("NDI source LIVE: \"DiscoCast Spike\" — {label}. Open NDI Video Monitor. {secs}s.");
    let mut buf = vec![0u8; w * h * 4];
    let start = Instant::now();
    let (mut frame, mut last_log, mut enc_ms_acc) = (0u64, Instant::now(), 0f64);
    while start.elapsed().as_secs() < secs {
        fill_pattern(&mut buf, w, h, frame as usize);
        if encode_roundtrip {
            let t0 = Instant::now();
            let jpg = encode_jpeg_from_bgra(&buf, w as u32, h as u32, 80);
            if let Some((dw, dh, mut bgra)) = decode_jpeg_to_bgra(&jpg) {
                enc_ms_acc += t0.elapsed().as_secs_f64() * 1000.0;
                sender.send_bgra(dw as c_int, dh as c_int, &mut bgra);
            }
        } else {
            sender.send_bgra(w as c_int, h as c_int, &mut buf);
        }
        frame += 1;
        if last_log.elapsed().as_secs() >= 2 {
            let fps = frame as f64 / start.elapsed().as_secs_f64();
            let avg = if frame > 0 { enc_ms_acc / frame as f64 } else { 0.0 };
            if encode_roundtrip {
                println!("  frame {frame}  avg {fps:.1} fps  jpeg roundtrip ~{avg:.1} ms/frame");
            } else {
                println!("  frame {frame}  avg {fps:.1} fps");
            }
            last_log = Instant::now();
        }
    }
    println!("done — {frame} frames");
}

fn run_stream(name: &str) {
    let sender = match NdiSender::new(name, (30, 1), false) {
        Some(s) => s,
        None => { eprintln!("NDI init/create failed"); std::process::exit(1); }
    };
    eprintln!("ndi-stream: source \"{name}\" ready; reading JPEG frames from stdin.");
    let mut stdin = std::io::stdin().lock();
    let mut len_buf = [0u8; 4];
    let (start, mut frame, mut last_log, mut dec_ms_acc) = (Instant::now(), 0u64, Instant::now(), 0f64);
    loop {
        if stdin.read_exact(&mut len_buf).is_err() {
            break; // EOF / closed pipe
        }
        let len = u32::from_le_bytes(len_buf) as usize;
        if len == 0 || len > 64 * 1024 * 1024 {
            eprintln!("ndi-stream: bad frame length {len}, stopping");
            break;
        }
        let mut jpg = vec![0u8; len];
        if stdin.read_exact(&mut jpg).is_err() {
            break; // partial frame at EOF
        }
        let t0 = Instant::now();
        match decode_jpeg_to_bgra(&jpg) {
            Some((w, h, mut bgra)) => {
                dec_ms_acc += t0.elapsed().as_secs_f64() * 1000.0;
                sender.send_bgra(w as c_int, h as c_int, &mut bgra);
                frame += 1;
            }
            None => eprintln!("ndi-stream: jpeg decode failed ({len} bytes)"),
        }
        if last_log.elapsed().as_secs() >= 2 {
            let fps = frame as f64 / start.elapsed().as_secs_f64();
            let avg = if frame > 0 { dec_ms_acc / frame as f64 } else { 0.0 };
            eprintln!("  ndi-stream: {frame} frames  {fps:.1} fps  decode ~{avg:.1} ms");
            let _ = std::io::stderr().flush();
            last_log = Instant::now();
        }
    }
    eprintln!("ndi-stream: stdin closed after {frame} frames");
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(|s| s.as_str()).unwrap_or("stream");
    match mode {
        "selftest" => run_selftest(args.get(2).and_then(|s| s.parse().ok()).unwrap_or(180), false),
        "pipe-selftest" => run_selftest(args.get(2).and_then(|s| s.parse().ok()).unwrap_or(180), true),
        "stream" => run_stream(args.get(2).map(|s| s.as_str()).unwrap_or("DiscoCast Program")),
        other => {
            eprintln!("unknown mode '{other}'. use: selftest | pipe-selftest | stream [name]");
            std::process::exit(2);
        }
    }
}
