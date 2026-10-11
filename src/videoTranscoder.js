/**
 * Video Transcoder — Lazy-loaded FFmpeg.wasm for auto-downscaling oversized videos
 *
 * Automatically converts 1080p/4K videos to 720p on upload.
 * Lazy-loads FFmpeg only when needed (~32MB wasm, loaded on first use).
 *
 * The FFmpeg core is self-hosted: Vite emits @ffmpeg/core's JS + wasm into the
 * build and we pass their local URLs to load(). Without this, @ffmpeg/ffmpeg
 * fetches the core from unpkg.com at runtime — which fails offline (video
 * import impossible) and is blocked outright by the web build's CSP.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

// Singleton instance — loaded on first use
let ffmpegInstance = null;
let isLoading = false;
let loadPromise = null;

/**
 * Lazy-load FFmpeg.wasm — returns singleton instance
 */
export async function getFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  if (isLoading) return loadPromise;

  isLoading = true;
  loadPromise = (async () => {
    console.log('[VideoTranscoder] Loading FFmpeg.wasm (~32MB)...');
    const ffmpeg = new FFmpeg();

    // Progress callback for loading (can be wired to UI)
    ffmpeg.on('log', ({ message }) => {
      // console.log('[FFmpeg]', message);
    });

    await ffmpeg.load({ coreURL, wasmURL });
    ffmpegInstance = ffmpeg;
    console.log('[VideoTranscoder] FFmpeg.wasm loaded');
    return ffmpeg;
  })().catch((err) => {
    // Don't cache a failed load — let the next video import retry it instead
    // of failing until the page reloads.
    isLoading = false;
    loadPromise = null;
    throw err;
  });

  return loadPromise;
}

/**
 * Transcode video to 720p H.264
 * @param {File} file — Input video file
 * @param {Function} onProgress — Callback(progress: { percent: number, time: number })
 * @returns {Promise<File>} — Transcoded 720p video file
 */
export async function transcodeTo720p(file, onProgress = null) {
  const ffmpeg = await getFFmpeg();

  const inputName = 'input' + getExtension(file.name);
  const outputName = 'output.mp4';

  // Write input file to FFmpeg virtual FS
  console.log('[VideoTranscoder] Writing input file...');
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  // Set up progress tracking (removed after the run so listeners don't pile up
  // on the shared singleton across imports)
  const progressHandler = onProgress && ((progress) => {
    // progress.time is in seconds (processed duration)
    // Estimate total based on file or just report time processed
    onProgress({
      percent: Math.min(progress.progress * 100, 99), // FFmpeg progress can be flaky
      time: progress.time,
      ratio: progress.progress
    });
  });
  if (progressHandler) ffmpeg.on('progress', progressHandler);

  // Run transcode: scale to 720p, fast preset, good quality
  console.log('[VideoTranscoder] Transcoding to 720p...');
  try {
    await ffmpeg.exec([
      '-i', inputName,
      '-vf', 'scale=-2:720:flags=lanczos',  // Scale to 720p height, auto width to maintain aspect
      '-c:v', 'libx264',
      '-preset', 'fast',      // Balance of speed vs quality
      '-crf', '23',           // High quality (18-23 is visually lossless)
      '-movflags', '+faststart', // Web-optimized for streaming
      '-an',                  // No audio — we don't need it for VJ visuals
      '-y',                   // Overwrite output
      outputName
    ]);
  } finally {
    if (progressHandler) ffmpeg.off('progress', progressHandler);
  }

  // Read output file
  console.log('[VideoTranscoder] Reading output file...');
  const data = await ffmpeg.readFile(outputName);

  // Cleanup virtual FS
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  // Create new File object
  const outputFile = new File([data], file.name.replace(/\.[^/.]+$/, '') + '_720p.mp4', {
    type: 'video/mp4',
    lastModified: Date.now()
  });

  console.log('[VideoTranscoder] Transcode complete:', formatBytes(file.size), '→', formatBytes(outputFile.size));
  return outputFile;
}

/**
 * Strip the audio track from a video without re-encoding the video stream.
 * Lossless remux (`-c:v copy -an`) — finishes in seconds even on 50MB+ clips.
 *
 * Invariant: every video that enters this app must pass through here (or
 * `transcodeTo720p`, which also strips audio via `-an`). Audio-laden video
 * elements can grab the MediaSession in WKWebView and disrupt the main
 * audio player. We never use video audio in this app, so it's safe to drop.
 */
export async function stripAudio(file) {
  const ffmpeg = await getFFmpeg();

  const inputName = 'strip_in' + getExtension(file.name);
  const outputName = 'strip_out' + getExtension(file.name);

  await ffmpeg.writeFile(inputName, await fetchFile(file));

  await ffmpeg.exec([
    '-i', inputName,
    '-c:v', 'copy',
    '-an',
    '-y',
    outputName,
  ]);

  const data = await ffmpeg.readFile(outputName);

  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  const outputFile = new File([data], file.name, {
    type: file.type || 'video/mp4',
    lastModified: Date.now(),
  });

  console.log('[VideoTranscoder] Audio stripped:', formatBytes(file.size), '→', formatBytes(outputFile.size));
  return outputFile;
}

/**
 * Check if video needs transcoding (over 720p)
 */
export function needsTranscode(videoWidth, videoHeight) {
  const MAX_WIDTH = 1280;
  const MAX_HEIGHT = 720;
  return videoWidth > MAX_WIDTH || videoHeight > MAX_HEIGHT;
}

/**
 * Estimate transcode time based on file size and duration
 * Rough heuristic: ~2-5x real-time on modern machines
 */
export function estimateTranscodeTime(durationSeconds) {
  // Conservative estimate: 3x real-time (1 minute video = 3 minutes transcode)
  return durationSeconds * 3;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function getExtension(filename) {
  const ext = filename.split('.').pop();
  return ext ? '.' + ext.toLowerCase() : '.mp4';
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
