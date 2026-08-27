#!/usr/bin/env python3
"""Génère une icône 1024x1024 "retrowave" (dégradé magenta→indigo + horizon cyan).
Utilise uniquement la bibliothèque standard (zlib + struct)."""
import zlib, struct, math, os

W = H = 1024

def raw_row(row):
    return b"\x00" + row

rows = []
for y in range(H):
    t = y / H
    # dégradé vertical : indigo (bas) -> magenta (haut)
    r = int(32 + (230 - 32) * t)
    g = int(24 + (40 - 24) * t)
    b = int(80 + (200 - 80) * t)
    row = bytearray()
    for x in range(W):
        rr, gg, bb = r, g, b
        # "soleil" : disque cyan près du centre bas
        dx = (x - W // 2) / W
        dy = (y - int(H * 0.62)) / H
        d = math.hypot(dx, dy)
        if d < 0.20:
            rr = 34; gg = 224; bb = 255
        elif d < 0.22:
            rr, gg, bb = 34, 120, 255
        # horizon rétro : lignes horizontales cyan espacées
        if y > int(H * 0.66):
            if (y * 6 // 16) % 2 == 0:
                rr = min(255, rr + 90); gg = min(255, gg + 110); bb = 255
        # lignes de balayage
        if y % 3 == 0:
            rr = int(rr * 0.80); gg = int(gg * 0.80); bb = int(bb * 0.80)
        row += bytes((rr, gg, bb))
    rows.append(raw_row(row))

raw = b"".join(rows)
def chunk(typ, data):
    c = struct.pack(">I", len(data)) + typ + data
    c += struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
    return c

png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(raw, 9))
png += chunk(b"IEND", b"")

out = "crates/app/icon-source.png"
os.makedirs("crates/app", exist_ok=True)
with open(out, "wb") as f:
    f.write(png)
print("wrote", out, len(png), "bytes")
