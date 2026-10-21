"""Build a marketplace-ready ZIP for Edge / Chrome upload.

Usage:
    python tools/package_release.py

Output:
    dist/claude-archive-exporter.zip
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "dist", "claude-archive-exporter.zip")

FILES = [
    "manifest.json",
    "content.js",
    "zip.js",
    "privacy.html",
    "README.md",
    "RELEASE.md",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png",
    "icons/screenshot1.png",
    "icons/screenshot2.png",
]


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    if os.path.exists(OUT):
        os.remove(OUT)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in FILES:
            path = os.path.join(ROOT, *rel.split("/"))
            if not os.path.exists(path):
                raise SystemExit(f"missing required file: {rel}")
            zf.write(path, "claude-archive-exporter/" + rel.replace("/", os.sep))
    print(OUT)
    print("size", os.path.getsize(OUT))


if __name__ == "__main__":
    main()
