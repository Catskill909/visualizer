//! N0 NDI spike (throwaway) — native-output-dev.md §7.
//!
//! Broadcasts an animated BGRA test frame as an NDI source named
//! "DiscoCast Spike". Proves the one hard unknown: Rust → NDI runtime → a
//! receiver (NDI Video Monitor / OBS via DistroAV), standalone from the app.
//!
//! Minimal hand-rolled FFI against /usr/local/lib/libndi.dylib (no SDK headers).
//! Struct layouts mirror Processing.NDI.structs.h exactly (#[repr(C)]).

use std::ffi::CString;
use std::os::raw::{c_char, c_int, c_void};
use std::time::Instant;

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
    four_cc: c_int,            // NDIlib_FourCC_video_type_e
    frame_rate_n: c_int,
    frame_rate_d: c_int,
    picture_aspect_ratio: f32, // 0 => xres/yres
    frame_format_type: c_int,  // NDIlib_frame_format_type_e
    timecode: i64,
    p_data: *mut u8,
    line_stride_in_bytes: c_int, // union with data_size_in_bytes
    p_metadata: *const c_char,
    timestamp: i64,
}

extern "C" {
    fn NDIlib_initialize() -> bool;
    fn NDIlib_destroy();
    fn NDIlib_send_create(create: *const NdiSendCreate) -> *mut c_void;
    fn NDIlib_send_destroy(instance: *mut c_void);
    fn NDIlib_send_send_video_v2(instance: *mut c_void, frame: *const NdiVideoFrameV2);
    fn NDIlib_send_get_no_connections(instance: *mut c_void, timeout_ms: c_int) -> c_int;
}

const BGRA: c_int = 0x4152_4742; // NDI_LIB_FOURCC('B','G','R','A')
const PROGRESSIVE: c_int = 1;
const SYNTHESIZE_TIMECODE: i64 = i64::MAX; // NDIlib_send_timecode_synthesize

fn main() {
    let secs: u64 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(180);
    let (w, h) = (1280usize, 720usize);

    unsafe {
        if !NDIlib_initialize() {
            eprintln!("NDIlib_initialize failed (unsupported CPU?).");
            std::process::exit(1);
        }
        let name = CString::new("DiscoCast Spike").unwrap();
        let create = NdiSendCreate {
            p_ndi_name: name.as_ptr(),
            p_groups: std::ptr::null(),
            clock_video: true, // NDI paces us to the frame rate
            clock_audio: false,
        };
        let sender = NDIlib_send_create(&create);
        if sender.is_null() {
            eprintln!("NDIlib_send_create failed.");
            NDIlib_destroy();
            std::process::exit(1);
        }
        println!(
            "NDI source LIVE: \"DiscoCast Spike\" — open NDI Video Monitor or add an NDI source in OBS.\nSending {w}x{h} BGRA @30fps for {secs}s (clock-paced)."
        );

        let mut buf = vec![0u8; w * h * 4];
        let start = Instant::now();
        let mut frame: u64 = 0;
        let mut last_log = Instant::now();

        while start.elapsed().as_secs() < secs {
            let t = frame as usize;
            for y in 0..h {
                let row = y * w * 4;
                for x in 0..w {
                    let i = row + x * 4;
                    buf[i]     = ((x + y + t * 2) & 0xff) as u8; // B
                    buf[i + 1] = ((y + t / 2) & 0xff) as u8;     // G
                    buf[i + 2] = ((x + t) & 0xff) as u8;         // R
                    buf[i + 3] = 255;                            // A
                }
            }
            let vf = NdiVideoFrameV2 {
                xres: w as c_int,
                yres: h as c_int,
                four_cc: BGRA,
                frame_rate_n: 30,
                frame_rate_d: 1,
                picture_aspect_ratio: 0.0,
                frame_format_type: PROGRESSIVE,
                timecode: SYNTHESIZE_TIMECODE,
                p_data: buf.as_mut_ptr(),
                line_stride_in_bytes: (w * 4) as c_int,
                p_metadata: std::ptr::null(),
                timestamp: 0,
            };
            NDIlib_send_send_video_v2(sender, &vf); // synchronous + clock-paced
            frame += 1;

            if last_log.elapsed().as_secs() >= 2 {
                let conns = NDIlib_send_get_no_connections(sender, 0);
                let fps = frame as f64 / start.elapsed().as_secs_f64();
                println!("  t={:>3}s  frame {frame}  avg {fps:.1} fps  receivers: {conns}", start.elapsed().as_secs());
                last_log = Instant::now();
            }
        }

        NDIlib_send_destroy(sender);
        NDIlib_destroy();
        println!("Spike finished. Sent {frame} frames.");
    }
}
