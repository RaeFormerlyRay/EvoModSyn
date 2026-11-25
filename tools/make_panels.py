#!/usr/bin/env python3
"""Generate worn, scratched front-panel textures for every PatchMind module.

Each panel is painted procedurally: a paint finish (enamel, hammertone, bare metal),
mottling and grime, chipped paint showing metal or rust underneath, scratches, scuffed
edges and rust blooms. Output: assets/panels/<name>.webp (used by the app) and
assets/panels/png/<name>.png (full-quality PNGs).

Usage: python3 tools/make_panels.py
"""
import math, pathlib, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'panels'
H = 388          # module height in CSS pixels
SCALE = 1.5      # texture pixels per CSS pixel

# name: (css width, finish, base rgb, wear amount, rust amount, light ink?)
PANELS = {
    'clock':   (190, 'enamel',    (226, 219, 198), 0.55, 0.25, True),   # cream, like an old Tokai
    'seq':     (392, 'hammer',    (150, 154, 158), 0.45, 0.20, True),   # hammertone silver, Big Muff style
    'ent':     (270, 'enamel',    (46, 36, 70),    0.60, 0.35, False),  # deep violet enamel
    'drums':   (440, 'enamel',    (233, 150, 34),  0.60, 0.30, True),   # wah-pedal orange
    'analog':  (352, 'enamel',    (24, 24, 24),    0.75, 0.80, False),  # black crinkle, rat-style rust
    'acid':    (352, 'enamel',    (30, 27, 24),    0.85, 0.95, False),  # the most beaten-up one
    'lead':    (352, 'enamel',    (28, 44, 78),    0.55, 0.35, False),  # navy
    'titan':   (600, 'enamel',    (150, 28, 30),   0.65, 0.45, False),  # red, like the old wah
    'chip':    (270, 'enamel',    (48, 120, 186),  0.55, 0.25, False),  # DOD blue
    'bodies':  (270, 'hammer',    (120, 96, 52),   0.50, 0.40, False),  # brass hammertone
    'geiger':  (250, 'enamel',    (78, 88, 52),    0.70, 0.60, False),  # military olive
    'serge':   (200, 'enamel',    (26, 40, 58),    0.55, 0.40, False),  # Serge blue-black
    'mixer':   (480, 'brushed',   (168, 170, 172), 0.35, 0.15, True),   # brushed aluminium
    'monitor': (320, 'enamel',    (20, 22, 26),    0.45, 0.30, False),
    'contour': (330, 'enamel',    (18, 18, 20),    0.70, 0.55, False),  # black, Maths-like
    'swarm':   (420, 'enamel',    (28, 64, 48),    0.60, 0.40, False),  # racing green
    'workout': (440, 'enamel',    (52, 58, 66),    0.60, 0.35, False),  # gunmetal
    'grains':  (380, 'enamel',    (214, 206, 182), 0.55, 0.30, True),   # bone white
    'marbles': (360, 'enamel',    (30, 70, 78),    0.60, 0.35, False),  # teal
    'toolbox': (470, 'brushed',   (150, 152, 150), 0.45, 0.30, True),   # bare steel
    'tape':    (230, 'enamel',    (92, 30, 26),    0.65, 0.50, False),  # oxblood tape deck
    'reel':    (410, 'enamel',    (70, 44, 26),    0.60, 0.45, False),  # walnut-brown tape keyboard
    'lpg':     (300, 'hammer',    (58, 92, 70),    0.55, 0.40, False),  # green hammertone
    # effects
    'halls':    (360, 'enamel',  (206, 214, 224), 0.50, 0.25, True),   # pale blue-grey, old studio gear
    'echoes':   (380, 'hammer',  (128, 96, 40),   0.65, 0.55, False),  # bronze hammertone tape echo
    'ensemble': (340, 'enamel',  (34, 96, 92),    0.55, 0.35, False),  # sea green
    'phaser':   (330, 'enamel',  (92, 40, 120),   0.60, 0.40, False),  # purple pedal
    'heat':     (360, 'enamel',  (176, 52, 20),   0.80, 0.70, False),  # burnt orange, beaten up
    'bode':     (330, 'brushed', (120, 132, 140), 0.50, 0.30, False),  # lab grey
    'sympathy': (360, 'enamel',  (222, 204, 160), 0.55, 0.35, True),   # ivory
    'vowel':    (330, 'enamel',  (150, 40, 100),  0.60, 0.40, False),  # magenta
    'pump':     (350, 'enamel',  (40, 70, 30),    0.65, 0.50, False),  # dark olive
    'stutter':  (340, 'enamel',  (140, 20, 36),   0.75, 0.60, False),  # crimson
    'prism':    (340, 'hammer',  (70, 62, 120),   0.55, 0.35, False),  # indigo hammertone
    'cassette': (330, 'enamel',  (200, 178, 140), 0.70, 0.55, True),   # tan, sun-faded
    'horizon':  (350, 'enamel',  (14, 14, 30),    0.70, 0.60, False),  # deep space black
    # modulation
    'orbit':    (430, 'enamel',  (20, 52, 64),    0.60, 0.40, False),  # petrol
    'performer':(440, 'hammer',  (64, 50, 30),    0.60, 0.45, False),  # dark bronze
    'attractor':(330, 'enamel',  (44, 24, 64),    0.65, 0.50, False),  # aubergine
    'macros':   (360, 'enamel',  (230, 200, 200), 0.50, 0.30, True),   # faded pink
    'follower': (280, 'brushed', (110, 120, 112), 0.55, 0.40, False),  # steel
    'prime':   (470, 'enamel',    (168, 52, 38),   0.60, 0.45, False),  # brick red
}


def fbm(h, w, rng, octaves=6, base=4, persistence=0.55):
    """Fractal value noise in 0..1."""
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        cells = base * (2 ** o)
        gh, gw = max(2, int(cells * h / max(h, w)) + 2), max(2, int(cells * w / max(h, w)) + 2)
        grid = rng.random((gh, gw)).astype(np.float32)
        img = Image.fromarray((grid * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += amp * (np.asarray(img, np.float32) / 255)
        tot += amp
        amp *= persistence
    out /= tot
    out -= out.min()
    out /= max(1e-6, out.max())
    return out


def edge_dist(h, w):
    y = np.minimum(np.arange(h), np.arange(h)[::-1])[:, None] / h
    x = np.minimum(np.arange(w), np.arange(w)[::-1])[None, :] / w
    return np.minimum(y * h, x * w)  # pixels to nearest edge


def scratches(h, w, rng, n, light):
    """Scratch mask 0..1: long thin strokes, short scuffs and swirl marks."""
    img = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(img)
    # a dominant direction, like the panel was dragged across a table
    main = rng.uniform(0, math.pi)
    for i in range(n):
        ang = main + rng.normal(0, 0.5) if rng.random() < 0.6 else rng.uniform(0, math.pi)
        L = rng.choice([rng.uniform(8, 40), rng.uniform(30, 160), rng.uniform(120, 420)], p=[0.5, 0.38, 0.12])
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        pts = [(x, y)]
        bend = rng.normal(0, 0.15)
        segs = max(2, int(L / 12))
        for s in range(segs):
            ang += bend / segs + rng.normal(0, 0.03)
            x += math.cos(ang) * L / segs
            y += math.sin(ang) * L / segs
            pts.append((x, y))
        a = int(rng.uniform(30, 190))
        d.line(pts, fill=a, width=1 if rng.random() < 0.85 else 2)
    # swirl marks (polishing / rubbing)
    for i in range(int(n / 25)):
        cx, cy, r = rng.uniform(0, w), rng.uniform(0, h), rng.uniform(20, 90)
        for k in range(rng.integers(6, 16)):
            rr = max(4.0, r + rng.normal(0, r * 0.25))
            a0 = rng.uniform(0, 360)
            d.arc([cx - rr, cy - rr, cx + rr, cy + rr], a0, a0 + rng.uniform(20, 90), fill=int(rng.uniform(25, 80)))
    return np.asarray(img.filter(ImageFilter.GaussianBlur(0.6)), np.float32) / 255


def hammer(h, w, rng):
    """Hammertone dimples: blurred cellular bumps turned into shading."""
    pts = rng.random((int(h * w / 260), 2)) * [h, w]
    img = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(img)
    for y, x in pts:
        r = rng.uniform(4, 9)
        d.ellipse([x - r, y - r, x + r, y + r], fill=int(rng.uniform(120, 255)))
    a = np.asarray(img.filter(ImageFilter.GaussianBlur(3)), np.float32) / 255
    gy, gx = np.gradient(a)
    return np.clip(0.5 + (gx * 0.7 - gy * 0.7) * 6, 0, 1)


def brushed(h, w, rng):
    n = rng.random((h, w)).astype(np.float32)
    img = Image.fromarray((n * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(0))
    img = img.resize((w // 40 + 1, h), Image.BILINEAR).resize((w, h), Image.BICUBIC)  # long horizontal streaks
    a = np.asarray(img, np.float32) / 255
    return (a - a.mean()) * 1.6 + 0.5


def make(name, spec, seed):
    cw, finish, base, wear, rust, light = spec
    w, h = int(cw * SCALE), int(H * SCALE)
    rng = np.random.default_rng(seed)
    random.seed(seed)
    base = np.array(base, np.float32) / 255
    metal = np.array([0.72, 0.72, 0.70], np.float32)
    rust_c = np.array([0.45, 0.22, 0.09], np.float32)
    rust_d = np.array([0.24, 0.11, 0.05], np.float32)

    # 1. paint with mottling
    mott = fbm(h, w, rng, 6, 3)
    img = base[None, None, :] * (0.86 + 0.24 * mott[..., None])
    if finish == 'hammer':
        hm = hammer(h, w, rng)
        img = img * (0.78 + 0.44 * hm[..., None])
    if finish == 'brushed':
        br = brushed(h, w, rng)
        img = img * (0.9 + 0.2 * br[..., None])
    # crinkle / grain on enamel
    grain = rng.normal(0, 0.018, (h, w, 1)).astype(np.float32)
    img = img + grain

    ed = edge_dist(h, w)
    edge_w = np.exp(-ed / (22 * SCALE))           # 1 at the edge
    corner = np.exp(-(np.minimum.reduce([np.hypot(*np.meshgrid(np.arange(w) - cx, np.arange(h) - cy)) for cx in (0, w) for cy in (0, h)])) / (70 * SCALE))

    # 2. grime collects near the edges and in patches
    grime = fbm(h, w, rng, 5, 5) * (0.35 + 0.65 * edge_w)
    img = img * (1 - 0.32 * grime[..., None] * (1.4 if light else 1))

    # 3. chipped paint: exposed metal with a rust rim
    chip_n = fbm(h, w, rng, 6, 8, 0.6)
    thresh = 0.93 - wear * 0.10 - edge_w * (0.22 + wear * 0.14) - corner * 0.22
    chip = np.clip((chip_n - thresh) * 14, 0, 1)
    rim = np.clip((chip_n - (thresh - 0.035)) * 14, 0, 1) - chip
    rim = np.clip(rim, 0, 1)
    metal_tex = metal[None, None, :] * (0.78 + 0.3 * fbm(h, w, rng, 4, 20)[..., None])
    under = metal_tex * (1 - rust * 0.6) + rust_c * rust * 0.6
    img = img * (1 - chip[..., None]) + under * chip[..., None]
    img = img * (1 - rim[..., None] * 0.65 * rust) + rust_d * rim[..., None] * 0.65 * rust

    # 4. rust blooms
    if rust > 0.05:
        bloom = fbm(h, w, rng, 6, 6, 0.62)
        speck = (rng.random((h, w)) < 0.006 * rust).astype(np.float32)
        speck = np.asarray(Image.fromarray((speck * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255
        bl = np.clip((bloom - (0.93 - rust * 0.12 - edge_w * 0.18)) * 8, 0, 1) * (0.6 + 0.4 * fbm(h, w, rng, 3, 30)) + speck * 2
        bl = np.clip(bl, 0, 1)
        rc = rust_c * (0.75 + 0.5 * fbm(h, w, rng, 4, 40)[..., None])
        img = img * (1 - bl[..., None] * 0.85) + rc * bl[..., None] * 0.85

    # 5. scratches: bright on dark paint (metal shows), dark on light paint (dirt in the groove)
    sc = scratches(h, w, rng, int(60 + 260 * wear * (w * h) / (500 * 580)), light)
    if light:
        img = img * (1 - 0.32 * sc[..., None])
    else:
        img = img * (1 - sc[..., None] * 0.55) + (metal * 1.05)[None, None, :] * sc[..., None] * 0.55
    # fine hairline scuffs
    fine = scratches(h, w, rng, int(500 * (w * h) / (500 * 580)), light) * 0.25
    img = img + (fine[..., None] * (-0.18 if light else 0.22))

    # 6. bevel: light top/left edge, shadow bottom/right
    yy = np.arange(h)[:, None].astype(np.float32); xx = np.arange(w)[None, :].astype(np.float32)
    bev = 3 * SCALE
    img = img + 0.10 * (np.exp(-yy / bev) + np.exp(-xx / bev))[..., None] - 0.16 * (np.exp(-(h - 1 - yy) / bev) + np.exp(-(w - 1 - xx) / bev))[..., None]
    # soft vignette so the centre stays readable
    vig = 1 - 0.18 * edge_w
    img = img * vig[..., None]

    img = np.clip(img, 0, 1)
    out = Image.fromarray((img * 255).astype(np.uint8), 'RGB')
    (OUT / 'png').mkdir(parents=True, exist_ok=True)
    out.save(OUT / 'png' / f'{name}.png', optimize=True)
    out.save(OUT / f'{name}.webp', quality=74, method=6)
    return (OUT / f'{name}.webp').stat().st_size


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for i, (name, spec) in enumerate(PANELS.items()):
        size = make(name, spec, 1000 + i * 17)
        total += size
        print(f'{name:8s} {size / 1024:6.1f} KB')
    print(f'total {total / 1024:.0f} KB')
