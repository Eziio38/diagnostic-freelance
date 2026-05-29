#!/usr/bin/env python3
"""Generate PNG app icons for the MeetTranscriber PWA."""

import os
from PIL import Image, ImageDraw

BG = (11, 16, 32)       # #0b1020
ACCENT = (91, 140, 255)  # #5b8cff
WHITE = (238, 241, 248)

SIZES = [192, 512, 180]


def make(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(img)

    # Rounded background panel
    pad = int(size * 0.10)
    d.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=int(size * 0.18),
        fill=(22, 28, 48),
    )

    # Waveform bars centered
    bars = [0.30, 0.55, 0.80, 1.0, 0.70, 0.45, 0.65, 0.35]
    n = len(bars)
    cx = size / 2
    cy = size / 2
    bw = size * 0.05
    gap = size * 0.035
    total_w = n * bw + (n - 1) * gap
    x = cx - total_w / 2
    max_h = size * 0.34
    for i, h in enumerate(bars):
        bh = max_h * h
        color = ACCENT if i % 2 == 0 else WHITE
        d.rounded_rectangle(
            [x, cy - bh / 2, x + bw, cy + bh / 2],
            radius=int(bw / 2),
            fill=color,
        )
        x += bw + gap

    return img


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    for s in SIZES:
        path = os.path.join(here, f"icon-{s}.png")
        make(s).save(path, "PNG")
        print(f"Generated: {path}")


if __name__ == "__main__":
    main()
