/**
 * GIF Optimizer — Upload-time frame reduction and resize tool
 * 
 * Parses GIFs with gifuct-js, shows frame stats, allows:
 * - Keep every Nth frame (with automatic delay adjustment)
 * - Resize frames to target dimension
 * 
 * Returns processed frame data ready for _loadGifTexture
 */

import { parseGIF, decompressFrames } from 'gifuct-js';

/**
 * Parse a GIF file and return frame data + stats
 * @param {File} file - GIF file
 * @returns {Promise<{gif: object, rawFrames: array, width: number, height: number, frameCount: number, fileSize: number}>}
 */
export async function parseGifFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const gif = parseGIF(bytes.buffer);
    const rawFrames = decompressFrames(gif, true);
    
    return {
        gif,
        rawFrames,
        width: gif.lsd.width,
        height: gif.lsd.height,
        frameCount: rawFrames.length,
        fileSize: file.size,
        fileName: file.name
    };
}

/**
 * Calculate GPU memory estimate for GIF frames
 * @param {number} width 
 * @param {number} height 
 * @param {number} frameCount 
 * @returns {number} Estimated bytes
 */
export function estimateGpuMemory(width, height, frameCount) {
    // Each frame: width * height * 4 bytes (RGBA)
    // Plus texture overhead ~10%
    return width * height * 4 * frameCount * 1.1;
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Process GIF frames with reduction and resize options
 * @param {object} gifData - Output from parseGifFile
 * @param {object} options
 * @param {number} options.keepEveryN - Keep every Nth frame (1 = keep all, 2 = half, etc)
 * @param {number} options.targetSize - Max dimension for resize (0 = no resize)
 * @returns {Promise<{frames: Uint8ClampedArray[], delays: number[], width: number, height: number}>}
 */
export async function processGifFrames(gifData, options = {}) {
    const { gif, rawFrames, width: originalWidth, height: originalHeight } = gifData;
    const { keepEveryN = 1, targetSize = 0 } = options;
    
    // Determine output dimensions
    let outputWidth = originalWidth;
    let outputHeight = originalHeight;
    let scale = 1;
    
    if (targetSize > 0) {
        const maxDim = Math.max(originalWidth, originalHeight);
        if (maxDim > targetSize) {
            scale = targetSize / maxDim;
            outputWidth = Math.round(originalWidth * scale);
            outputHeight = Math.round(originalHeight * scale);
        }
    }
    
    const stride = originalWidth * 4;
    const outStride = outputWidth * 4;
    
    // Select frames to keep - simple every Nth frame selection
    const frames = [];
    const delays = [];
    const composite = new Uint8ClampedArray(originalWidth * originalHeight * 4);
    
    for (let i = 0; i < rawFrames.length; i++) {
        const f = rawFrames[i];
        const { left, top, width: fw, height: fh } = f.dims;
        
        // Dispose previous frame region if needed
        if (i > 0 && rawFrames[i - 1].disposalType === 2) {
            const { left: pl, top: pt, width: pw, height: ph } = rawFrames[i - 1].dims;
            for (let y = 0; y < ph; y++) {
                composite.fill(0, (pt + y) * stride + pl * 4, (pt + y) * stride + (pl + pw) * 4);
            }
        }
        
        // Composite patch
        for (let y = 0; y < fh; y++) {
            const srcRow = y * fw * 4;
            const dstRow = (top + y) * stride + left * 4;
            for (let x = 0; x < fw; x++) {
                const s = srcRow + x * 4;
                const d = dstRow + x * 4;
                if (f.patch[s + 3] > 0) {
                    composite[d] = f.patch[s];
                    composite[d + 1] = f.patch[s + 1];
                    composite[d + 2] = f.patch[s + 2];
                    composite[d + 3] = f.patch[s + 3];
                }
            }
        }
        
        // Keep every Nth frame (frame 0 always kept)
        if (i % keepEveryN === 0) {
            // Scale delay down to compensate for reduced frame count.
            // keepEveryN/2 strikes a balance: keepEveryN=4 → 2× faster, keepEveryN=6 → 3× faster.
            // Floor at 1 preserves native speed when keepEveryN=1 or 2.
            const originalDelay = Math.max((f.delay || 10) * 10, 20);
            const speedupFactor = Math.max(keepEveryN / 2, 1);
            const adjustedDelay = Math.max(originalDelay / speedupFactor, 10); // Floor at 10ms
            
            // Resize if needed
            if (scale !== 1) {
                const resized = resizeFrame(composite, originalWidth, originalHeight, outputWidth, outputHeight);
                frames.push(new Uint8ClampedArray(resized));
            } else {
                frames.push(new Uint8ClampedArray(composite));
            }
            
            delays.push(Math.round(adjustedDelay));
        }
    }
    
    return {
        frames,
        delays,
        width: outputWidth,
        height: outputHeight,
        originalWidth,
        originalHeight,
        frameCount: frames.length,
        originalFrameCount: rawFrames.length
    };
}

/**
 * Resize a single frame using nearest neighbor (fast) or bilinear (quality)
 */
function resizeFrame(src, srcW, srcH, dstW, dstH) {
    const dst = new Uint8ClampedArray(dstW * dstH * 4);
    const xRatio = srcW / dstW;
    const yRatio = srcH / dstH;
    
    for (let y = 0; y < dstH; y++) {
        for (let x = 0; x < dstW; x++) {
            const srcX = Math.min(Math.floor(x * xRatio), srcW - 1);
            const srcY = Math.min(Math.floor(y * yRatio), srcH - 1);
            const srcIdx = (srcY * srcW + srcX) * 4;
            const dstIdx = (y * dstW + x) * 4;
            
            dst[dstIdx] = src[srcIdx];
            dst[dstIdx + 1] = src[srcIdx + 1];
            dst[dstIdx + 2] = src[srcIdx + 2];
            dst[dstIdx + 3] = src[srcIdx + 3];
        }
    }
    
    return dst;
}

/**
 * Generate a frame strip preview as data URLs
 * @param {object} processedData - Output from processGifFrames
 * @param {number} maxFrames - Max frames to include in preview
 * @returns {Promise<string[]>} Array of data URLs for frame thumbnails
 */
export async function generateFrameStrip(processedData, maxFrames = 10) {
    const { frames, width, height } = processedData;
    const step = Math.max(1, Math.floor(frames.length / maxFrames));
    
    const previews = [];
    for (let i = 0; i < frames.length; i += step) {
        const dataUrl = frameToDataURL(frames[i], width, height);
        previews.push({
            index: i,
            dataUrl,
            delay: processedData.delays[i]
        });
        if (previews.length >= maxFrames) break;
    }
    
    return previews;
}

/**
 * Convert frame pixels to data URL for preview
 */
function frameToDataURL(pixels, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = new ImageData(pixels, width, height);
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
}

/**
 * Check if GIF exceeds optimization thresholds
 * @param {object} gifData - From parseGifFile
 * @returns {boolean}
 */
export function shouldOptimize(gifData) {
    const { frameCount, width, height, fileSize } = gifData;
    const maxDim = Math.max(width, height);
    
    // Aggressive thresholds from spec:
    // >10 frames, OR >256px, OR >1MB
    return frameCount > 10 || maxDim > 256 || fileSize > (1024 * 1024);
}

/**
 * Calculate recommended settings for a GIF
 * @param {object} gifData - From parseGifFile  
 * @returns {{keepEveryN: number, targetSize: number, reason: string}}
 */
export function getRecommendedSettings(gifData) {
    const { frameCount, width, height, fileSize } = gifData;
    const maxDim = Math.max(width, height);
    
    // Frame reduction priority - keep enough frames for smooth animation
    let keepEveryN = 1;
    let reason = '';
    
    if (frameCount > 100) {
        keepEveryN = Math.ceil(frameCount / 12); // Target ~10-12 frames for smoother animation
        reason = `Very high frame count (${frameCount}) — recommend keeping ~12 frames for smooth playback`;
    } else if (frameCount > 50) {
        keepEveryN = Math.ceil(frameCount / 10); // Target ~8-10 frames
        reason = `High frame count (${frameCount}) — recommend keeping ~10 frames for smooth playback`;
    } else if (frameCount > 20) {
        keepEveryN = Math.ceil(frameCount / 8); // Target ~8 frames
        reason = `Moderate frame count (${frameCount}) — recommend keeping ~8 frames`;
    } else if (frameCount > 10) {
        keepEveryN = 2; // Keep half
        reason = `${frameCount} frames — recommend keeping every 2nd frame`;
    }
    
    // Size reduction
    let targetSize = 0;
    if (maxDim > 400) {
        targetSize = 256;
        reason = reason || `Large dimensions (${width}×${height}) — recommend 256px max`;
    } else if (maxDim > 256) {
        targetSize = 192;
        reason = reason || `Moderate dimensions (${width}×${height}) — recommend 192px max`;
    }
    
    // File size warning
    if (fileSize > 5 * 1024 * 1024) {
        reason = reason || `Large file (${formatBytes(fileSize)}) — optimization strongly recommended`;
    }
    
    return { keepEveryN, targetSize, reason };
}
