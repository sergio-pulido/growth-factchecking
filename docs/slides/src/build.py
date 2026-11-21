"""Builds docs/slides/demo.html from src/demo.template.html, inlining the logos in assets/.
{{img:file}} becomes a data URL; {{svg:file:colour}} becomes inline SVG filled with that colour.
Run: python3 docs/slides/src/build.py"""
import base64
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
assets = root / 'assets'
types = {'.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg'}


def image(match):
    path = assets / match.group(1)
    return f"data:{types[path.suffix]};base64,{base64.b64encode(path.read_bytes()).decode()}"


def svg(match):
    text = (assets / match.group(1)).read_text()
    text = re.sub(r'<title>.*?</title>', '', text)
    return text.replace('<svg ', f'<svg fill="{match.group(2)}" aria-hidden="true" ', 1)


html = (root / 'src' / 'demo.template.html').read_text()
html = re.sub(r'\{\{img:([^}]+)\}\}', image, html)
html = re.sub(r'\{\{svg:([^:}]+):([^}]+)\}\}', svg, html)
(root / 'demo.html').write_text(html)
print('wrote', root / 'demo.html', len(html), 'bytes')
