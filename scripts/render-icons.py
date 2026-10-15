# One-off: renders public/icon.svg to PNG for iOS/Android home screens. Needs Playwright.
import sys, pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
svg = (root / 'public' / 'icon.svg').read_text()
with sync_playwright() as p:
    b = p.chromium.launch()
    for size in (180, 192, 512):
        pg = b.new_page(viewport={'width': size, 'height': size})
        pg.set_content(f'<body style="margin:0;background:#1F3FBF">{svg.replace("<svg ", f"<svg width=\"{size}\" height=\"{size}\" ")}</body>')
        pg.screenshot(path=str(root / 'web-src' / 'icons' / f'icon-{size}.png'))
    b.close()
