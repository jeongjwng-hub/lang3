#!/usr/bin/env python3
"""앱 아이콘(PNG): 크림색 바탕에 세 언어 색의 둥근 막대 3개."""
import os, struct, zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG = (246, 244, 239)
COLS = [(200, 66, 59), (42, 98, 201), (122, 75, 194)]


def png(size, path):
    rows = []
    bw = size * 0.16; gap = size * 0.07
    total = 3 * bw + 2 * gap
    x0 = (size - total) / 2
    heights = [0.50, 0.38, 0.44]
    r = bw / 2
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            c = BG
            for i, col in enumerate(COLS):
                left = x0 + i * (bw + gap)
                h = size * heights[i]
                top = (size - h) / 2
                cx = left + r
                if left <= x < left + bw:
                    if top + r <= y <= top + h - r:
                        c = col
                    else:
                        cy = top + r if y < top + r else top + h - r
                        if (x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= r * r:
                            c = col
            row += bytes(c)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "wb").write(data)


for s in (192, 512):
    png(s, os.path.join(ROOT, "icons", f"icon-{s}.png"))
print("ok")
