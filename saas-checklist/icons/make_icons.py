#!/usr/bin/env python3
"""Génère les icônes PNG de la PWA SaaS Daily — sans dépendance externe (zlib + struct).

Dessine un carré arrondi avec un dégradé bleu→vert et une coche blanche.
Usage: python3 make_icons.py
"""
import math
import os
import struct
import zlib

BG = (11, 16, 32)          # #0b1020
ACCENT = (91, 140, 255)    # #5b8cff (bleu)
GREEN = (34, 197, 94)      # #22c55e (vert)
WHITE = (255, 255, 255)
SIZES = [192, 512, 180]


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_alpha(x, y, x0, y0, x1, y1, r):
    """Couverture (0..1) d'un pixel dans un rectangle à coins arrondis (anti-aliasé)."""
    # distance signée au rectangle arrondi
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    inside_core = (x0 <= x <= x1) and (y0 <= y <= y1)
    d = math.hypot(x - cx, y - cy)
    if not inside_core:
        return 0.0
    # zone des coins
    return max(0.0, min(1.0, r - d + 0.5)) if d > r - 1 else 1.0


def dist_seg(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def make(size):
    s = size
    px = bytearray()
    pad = s * 0.10
    r = s * 0.22
    x0, y0, x1, y1 = pad, pad, s - pad, s - pad

    # géométrie de la coche
    thick = s * 0.075
    ax, ay = s * 0.32, s * 0.52
    bx, by = s * 0.44, s * 0.65
    cx, cy = s * 0.70, s * 0.36

    for y in range(s):
        px.append(0)  # filtre de ligne PNG = 0
        for x in range(s):
            cov = rounded_alpha(x + 0.5, y + 0.5, x0, y0, x1, y1, r)
            t = (x + y) / (2 * s)
            base = lerp(ACCENT, GREEN, t)
            col = lerp(BG, base, cov)

            # coche blanche
            d = min(
                dist_seg(x + 0.5, y + 0.5, ax, ay, bx, by),
                dist_seg(x + 0.5, y + 0.5, bx, by, cx, cy),
            )
            mark = max(0.0, min(1.0, (thick / 2) - d + 0.5))
            if mark > 0:
                col = lerp(col, WHITE, mark)

            px.extend(col)

    raw = bytes(px)
    comp = zlib.compress(raw, 9)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", s, s, 8, 2, 0, 0, 0)  # 8-bit, color type 2 (RGB)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", comp) + chunk(b"IEND", b"")


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    for sz in SIZES:
        path = os.path.join(here, f"icon-{sz}.png")
        with open(path, "wb") as f:
            f.write(make(sz))
        print("Généré:", path)


if __name__ == "__main__":
    main()
