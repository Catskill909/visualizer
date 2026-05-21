#!/usr/bin/env python3
import math, struct, zlib, os

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
W, H = 1320, 800

def clamp(v):
    return max(0, min(255, int(v)))

def radial_gradient(x, y, cx, cy, r_inner, r_outer, c_inner, c_outer):
    d = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    t = max(0.0, min(1.0, (d - r_inner) / (r_outer - r_inner)))
    return tuple(int(a + (b - a) * t) for a, b in zip(c_inner, c_outer))

def glow_alpha(x, y, cx, cy, radius, strength):
    d = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    if d > radius * 2.5:
        return 0.0
    return strength * math.exp(-(d * d) / (2 * (radius * 0.45) ** 2))

def write_png(path, pixels, w, h):
    def make_chunk(name, data):
        c = name + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    raw = b''
    for row in range(h):
        raw += b'\x00'
        raw += bytes([clamp(v) for px in pixels[row * w:(row + 1) * w] for v in px[:3]])

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    data = make_chunk(b'IHDR', ihdr)
    data += make_chunk(b'IDAT', zlib.compress(raw, 9))
    data += make_chunk(b'IEND', b'')

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + data)

print("Generating DMG background (1320x800)...")
pixels = []

# Icon center positions (1x = 330,320 and 990,320 — scaled to 2x)
left_cx, right_cx = 330, 990
icon_cy = 320

for y in range(H):
    for x in range(W):
        # Base radial gradient background: dark navy to near-black
        cx_bg, cy_bg = W / 2, H / 2
        d_bg = math.sqrt((x - cx_bg) ** 2 + (y - cy_bg) ** 2)
        t_bg = min(1.0, d_bg / (W * 0.6))
        r = int(26 + (8 - 26) * t_bg)
        g = int(26 + (8 - 26) * t_bg)
        b = int(46 + (16 - 46) * t_bg)

        # Purple glow on left
        ga_l = glow_alpha(x, y, left_cx, icon_cy, 160, 0.55)
        r = int(r * (1 - ga_l) + 80 * ga_l)
        g = int(g * (1 - ga_l) + 40 * ga_l)
        b = int(b * (1 - ga_l) + 200 * ga_l)

        # Blue glow on right
        ga_r = glow_alpha(x, y, right_cx, icon_cy, 160, 0.45)
        r = int(r * (1 - ga_r) + 20 * ga_r)
        g = int(g * (1 - ga_r) + 60 * ga_r)
        b = int(b * (1 - ga_r) + 200 * ga_r)

        # Subtle grid lines
        gx = min(x % 220, 220 - x % 220)
        gy = min(y % 160, 160 - y % 160)
        if gx < 1 or gy < 1:
            r = clamp(r + 4)
            g = clamp(g + 4)
            b = clamp(b + 6)

        pixels.append((r, g, b))

# Draw arrow (shaft + head)
arrow_y = icon_cy
shaft_x1, shaft_x2 = 530, 770
head_x, head_tip = 800, 320
opacity = 0.55

for y in range(H):
    for x in range(W):
        i = y * W + x
        px = pixels[i]
        blend = 0.0

        # Arrow shaft (3px thick with anti-alias)
        if shaft_x1 <= x <= shaft_x2:
            dy = abs(y - arrow_y)
            if dy < 2:
                blend = opacity * max(0.0, 1.0 - dy * 0.5)

        # Arrow head (triangle: tip at 800, base at x=760, y in [302, 338])
        if x >= 760 and x <= 800:
            width_at_x = (800 - x) / 40.0 * 18
            if abs(y - arrow_y) < width_at_x:
                blend = opacity

        if blend > 0:
            r, g, b = px
            pixels[i] = (
                clamp(r * (1 - blend) + 210 * blend),
                clamp(g * (1 - blend) + 210 * blend),
                clamp(b * (1 - blend) + 215 * blend),
            )

# Draw dashed circles around icon positions
def draw_dashed_circle(pixels, cx, cy, radius, w, h, dash_len=14, gap_len=10, opacity=0.12):
    circumference = 2 * math.pi * radius
    total = dash_len + gap_len
    for px_x in range(max(0, cx - radius - 3), min(w, cx + radius + 3)):
        for px_y in range(max(0, cy - radius - 3), min(h, cy + radius + 3)):
            dx, dy = px_x - cx, px_y - cy
            dist = math.sqrt(dx * dx + dy * dy)
            if abs(dist - radius) < 1.5:
                angle = (math.atan2(dy, dx) + math.pi) / (2 * math.pi)
                arc_pos = (angle * circumference) % total
                if arc_pos < dash_len:
                    blend = opacity * max(0, 1.0 - abs(dist - radius))
                    i = px_y * w + px_x
                    r2, g2, b2 = pixels[i]
                    pixels[i] = (
                        clamp(r2 + (255 - r2) * blend),
                        clamp(g2 + (255 - g2) * blend),
                        clamp(b2 + (255 - b2) * blend),
                    )

draw_dashed_circle(pixels, left_cx, icon_cy, 144, W, H, opacity=0.18)
draw_dashed_circle(pixels, right_cx, icon_cy, 144, W, H, opacity=0.18)

out_2x = os.path.join(OUT_DIR, 'dmg-background@2x.png')
write_png(out_2x, pixels, W, H)
print(f"Written: {out_2x}")

# Downsample 2x -> 1x by averaging 2x2 blocks
pixels_1x = []
for y in range(0, H, 2):
    for x in range(0, W, 2):
        p00 = pixels[y * W + x]
        p01 = pixels[y * W + x + 1] if x + 1 < W else p00
        p10 = pixels[(y+1) * W + x] if y + 1 < H else p00
        p11 = pixels[(y+1) * W + x + 1] if (y + 1 < H and x + 1 < W) else p00
        pixels_1x.append(tuple(int((p00[c]+p01[c]+p10[c]+p11[c])/4) for c in range(3)))

out_1x = os.path.join(OUT_DIR, 'dmg-background.png')
write_png(out_1x, pixels_1x, W//2, H//2)
print(f"Written: {out_1x}")
print("Done.")
