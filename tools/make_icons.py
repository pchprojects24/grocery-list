#!/usr/bin/env python3
"""Generate the Young Lists PWA icons as real PNG files.

iOS ignores SVG data-URI icons for Add to Home Screen and needs a PNG
apple-touch-icon, so the icons are checked in as PNGs rather than inlined in
manifest.json. This script regenerates them; it uses only the standard library
(zlib + struct), so there is nothing to install.

    python3 tools/make_icons.py

Writes young-lists/icons/*.png.
"""

import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "young-lists", "icons")

INDIGO = (79, 70, 229)      # --primary-color
WHITE = (255, 255, 255)
EMERALD = (16, 185, 129)    # --secondary-color

SS = 4                      # supersampling factor, for smooth edges


def rounded_rect(x0, y0, x1, y1, r):
    """Return a predicate telling whether a point is inside a rounded rect."""
    def inside(x, y):
        if x < x0 or x > x1 or y < y0 or y > y1:
            return False
        for cx, cy in ((x0 + r, y0 + r), (x1 - r, y0 + r), (x0 + r, y1 - r), (x1 - r, y1 - r)):
            in_x = (x < x0 + r) if cx == x0 + r else (x > x1 - r)
            in_y = (y < y0 + r) if cy == y0 + r else (y > y1 - r)
            if in_x and in_y:
                return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
        return True
    return inside


def thick_segment(ax, ay, bx, by, w):
    """Predicate for a line segment of width w with rounded caps."""
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy

    def inside(x, y):
        if length_sq == 0:
            t = 0.0
        else:
            t = ((x - ax) * dx + (y - ay) * dy) / length_sq
            t = max(0.0, min(1.0, t))
        px, py = ax + t * dx, ay + t * dy
        return (x - px) ** 2 + (y - py) ** 2 <= (w / 2.0) ** 2
    return inside


def render(size, padding_ratio=0.0):
    """Draw the icon at `size` px. padding_ratio insets the artwork (maskable)."""
    s = float(size)
    pad = s * padding_ratio
    inner = s - 2 * pad

    def u(v):
        """Artwork coordinate in 0..1 -> pixel coordinate."""
        return pad + v * inner

    # Background covers the whole canvas so a maskable crop never shows a gap.
    bg = rounded_rect(0, 0, s - 1, s - 1, s * 0.22)

    card = rounded_rect(u(0.20), u(0.14), u(0.80), u(0.86), inner * 0.07)

    lines = []
    for i, y in enumerate((0.30, 0.44, 0.58, 0.72)):
        # Checkbox square
        lines.append(("box", rounded_rect(u(0.28), u(y - 0.045), u(0.375), u(y + 0.05),
                                          inner * 0.015), i))
        # Text rule
        lines.append(("rule", thick_segment(u(0.43), u(y), u(0.72), u(y), inner * 0.045), i))

    # Two ticks in the first two checkboxes.
    ticks = []
    for y in (0.30, 0.44):
        ticks.append(thick_segment(u(0.297), u(y + 0.004), u(0.322), u(y + 0.028), inner * 0.026))
        ticks.append(thick_segment(u(0.322), u(y + 0.028), u(0.362), u(y - 0.026), inner * 0.026))

    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    x = px + (sx + 0.5) / SS
                    y = py + (sy + 0.5) / SS
                    if not bg(x, y):
                        continue
                    colour = INDIGO
                    if card(x, y):
                        colour = WHITE
                        for kind, hit, idx in lines:
                            if hit(x, y):
                                colour = INDIGO if kind == "rule" else (
                                    EMERALD if idx < 2 else INDIGO)
                                break
                        for tick in ticks:
                            if tick(x, y):
                                colour = WHITE
                                break
                    r += colour[0]
                    g += colour[1]
                    b += colour[2]
                    a += 255
            n = SS * SS
            if a == 0:
                row += b"\x00\x00\x00\x00"
            else:
                # Un-premultiply so edges blend against any background.
                cover = a / (255.0 * n)
                row += bytes((int(r / (n * cover)), int(g / (n * cover)),
                              int(b / (n * cover)), int(a / n)))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(png)
    print("wrote %s (%d bytes)" % (path, len(png)))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size, name, pad in (
        (192, "icon-192.png", 0.0),
        (512, "icon-512.png", 0.0),
        # Maskable icons get cropped to a circle by Android; keep art in the
        # middle 80%.
        (512, "icon-maskable-512.png", 0.12),
        # iOS home screen. iOS applies its own rounding, so no transparency.
        (180, "apple-touch-icon.png", 0.0),
    ):
        write_png(os.path.join(OUT_DIR, name), size, render(size, pad))


if __name__ == "__main__":
    main()
