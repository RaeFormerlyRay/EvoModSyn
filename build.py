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
# inline the worn panel textures as data URIs
import base64
panels = ','.join(f"'{f.stem}':'data:image/webp;base64,{base64.b64encode(f.read_bytes()).decode()}'" for f in sorted((root / 'assets/panels').glob('*.webp')))
body = body.replace('{/*BUILD:PANELS*/}', '{' + panels + '}')
out = root / 'dist' / 'patchmind.html'
out.parent.mkdir(exist_ok=True)
out.write_text(body.strip() + '\n')
# the sample library stays outside the page (it loads one bank at a time): copy it next to the build
import shutil
shutil.rmtree(out.parent / 'samples', ignore_errors=True)
shutil.copytree(root / 'samples', out.parent / 'samples')
print(out, len(body))
