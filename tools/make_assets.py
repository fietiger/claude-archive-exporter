"""Generate simple PNG icons and screenshots for marketplace upload.

Uses Pillow when available; falls back to standard-library PNG writer.
"""
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icons")


def rounded_gradient(size, dark=False, screenshot=False):
    """Return a PIL image with a simple teal->orange gradient tile and rounded border."""
    from PIL import Image, ImageDraw, ImageFont

    if dark:
        bg1 = (11, 110, 127)
        bg2 = (19, 32, 42)
        ink = (245, 246, 242)
    else:
        bg1 = (245, 246, 242)
        bg2 = (11, 110, 127)
        ink = (20, 35, 48)

    w, h = (size, size) if not screenshot else (size, int(size * 0.75))
    img = Image.new("RGB", (w, h), bg1)
    draw = ImageDraw.Draw(img)

    for i in range(w):
        t = i / max(1, w - 1)
        color = (
            int(bg1[0] * (1 - t) + bg2[0] * t),
            int(bg1[1] * (1 - t) + bg2[1] * t),
            int(bg1[2] * (1 - t) + bg2[2] * t),
        )
        draw.line([(i, 0), (i, h)], fill=color)

    m = max(2, size // 12)
    radius = max(6, size // 6)
    draw.rounded_rectangle(
        [m, m, w - m, h - m],
        radius=radius,
        outline=(255, 255, 255, 255),
        width=max(2, size // 24),
    )

    if size >= 48 or screenshot:
        font_size = max(14, size // 7)
        try:
            font = ImageFont.load_default(size=font_size)
        except TypeError:
            font = ImageFont.load_default()
        text = "Claude"
        bbox = draw.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text(((w - tw) / 2, (h - th) / 2), text, fill=ink, font=font)

    return img


def fallback_png(size, dark=False):
    """Generate a simple 1x1-like PNG with a single color, stdlib only."""
    color = (11, 110, 127) if not dark else (19, 32, 42)
    raw = bytearray()
    for _ in range(size):
        raw.append(0)
        raw.extend(color)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def main():
    os.makedirs(OUT, exist_ok=True)
    targets = [
        ("icon16.png", 16, False, False),
        ("icon32.png", 32, False, False),
        ("icon48.png", 48, False, False),
        ("icon128.png", 128, False, False),
        ("screenshot1.png", 480, False, True),
        ("screenshot2.png", 480, True, True),
    ]
    try:
        for name, size, dark, shot in targets:
            img = rounded_gradient(size, dark, shot)
            path = os.path.join(OUT, name)
            img.save(path)
            print(path)
    except ImportError:
        for name, size, dark, _ in targets:
            path = os.path.join(OUT, name)
            with open(path, "wb") as fh:
                fh.write(fallback_png(size, dark))
            print(path, "(fallback)")


if __name__ == "__main__":
    main()
