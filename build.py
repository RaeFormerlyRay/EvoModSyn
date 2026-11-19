#!/usr/bin/env python3
"""Inline src/ into one self-contained page body for publishing as a Claude artifact (dist/patchmind.html)."""
import re, pathlib
root = pathlib.Path(__file__).parent
html = (root / 'index.html').read_text()
body = html.split('<!--BODY-START-->')[1].split('<!--BODY-END-->')[0]
body = body.replace('<link rel="stylesheet" href="src/style.css">', '<style>\n' + (root / 'src/style.css').read_text() + '\n</style>')
def js(m):
    return '<script>\n' + (root / m.group(1)).read_text() + '\n</script>'
body = re.sub(r'<script src="(src/[a-z]+\.js)"></script>', js, body)
out = root / 'dist' / 'patchmind.html'
out.parent.mkdir(exist_ok=True)
out.write_text(body.strip() + '\n')
print(out, len(body))
