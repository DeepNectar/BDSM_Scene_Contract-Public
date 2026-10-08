"""Generate romantic cursive signature PNGs with transparent backgrounds.

Deep  -> https://drive.google.com/file/d/1KnoE8uWAwugB0PRMiPmq32eCW-ZxMasj/view?usp=sharing
Honey -> https://drive.google.com/file/d/1HRoqjVvSDswlROnookv0ykGagHwLQ6FI/view?usp=sharing
(The Drive links above are reference-only; browsers/print/email block hotlinked
Drive /view & /thumbnail URLs, so we commit LOCAL files to the repo instead.)
"""
import math, random
from PIL import Image, ImageDraw

def stroke(draw, pts, width, color):
    for i in range(len(pts) - 1):
        draw.line([pts[i], pts[i+1]], fill=color, width=width, joint="curve")
        r = width / 2
        for p in (pts[i], pts[i+1]):
            draw.ellipse([p[0]-r, p[1]-r, p[0]+r, p[1]+r], fill=color)

def arc(cx, cy, rx, ry, a0, a1, n=40):
    return [(cx + rx*math.cos(a), cy + ry*math.sin(a)) for a in [a0 + (a1-a0)*i/n for i in range(n+1)]]

def make_deep(path):
    W, H = 720, 260
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ink = (92, 34, 46, 255)          # deep wine ink
    random.seed(7)
    def jit(p): return (p[0] + random.uniform(-1.5, 1.5), p[1] + random.uniform(-1.5, 1.5))

    # capital D — grand looping bowl
    bowl = [(150, 55)] + arc(150, 130, 55, 78, -math.pi/2, math.pi/2, 48) + [(150, 205), (118, 212)]
    bowl += arc(122, 130, 26, 82, math.pi/2, -math.pi/2, 40)[::-1]
    stroke(d, [jit(p) for p in [(118, 60), (150, 55)]] , 6, ink)
    stroke(d, [jit(p) for p in bowl], 6, ink)
    # e — looped lowercase
    e = arc(235, 140, 34, 30, math.pi*0.9, math.pi*2.15, 44)
    stroke(d, [jit(p) for p in e], 6, ink)
    stroke(d, [jit(p) for p in [(205, 138), (262, 130), (285, 165), (300, 195)]], 5, ink)
    # crossbar of e
    stroke(d, [jit(p) for p in [(208, 132), (258, 128)]], 4, ink)
    # p — descender loop
    stroke(d, [jit(p) for p in [(310, 100), (300, 215), (296, 235), (310, 240)]], 6, ink)
    stroke(d, [jit(p) for p in arc(330, 160, 24, 24, -math.pi/2, math.pi*0.9, 36)], 5, ink)
    stroke(d, [jit(p) for p in [(305, 140), (348, 136)]], 4, ink)
    # second p
    stroke(d, [jit(p) for p in [(392, 100), (382, 215), (378, 235), (392, 240)]], 6, ink)
    stroke(d, [jit(p) for p in arc(412, 160, 24, 24, -math.pi/2, math.pi*0.9, 36)], 5, ink)
    stroke(d, [jit(p) for p in [(387, 140), (430, 136)]], 4, ink)
    # final flourish underline sweep
    tail = arc(360, 225, 260, 26, math.pi*1.15, math.pi*1.85, 60)
    stroke(d, [jit(p) for p in [(430, 150), (470, 175), (520, 190)] + tail], 5, ink)
    # heart dot over the i-dot position (romantic touch near start)
    hx, hy = 175, 40
    heart = [(hx, hy+7)] + arc(hx-5, hy, 5, 5, math.pi, 0, 12) + arc(hx+5, hy, 5, 5, math.pi, 0, 12)
    d.polygon(heart, fill=(158, 60, 74, 255))
    img.save(path)

def make_honey(path):
    W, H = 820, 280
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ink = (176, 108, 128, 255)       # rosy ink
    random.seed(11)
    def jit(p): return (p[0] + random.uniform(-1.5, 1.5), p[1] + random.uniform(-1.5, 1.5))

    # capital H — two stems + swoosh crossbar
    stroke(d, [jit(p) for p in [(120, 55), (108, 150), (100, 205), (112, 210)]], 6, ink)
    stroke(d, [jit(p) for p in [(215, 50), (205, 145), (198, 200), (210, 208)]], 6, ink)
    stroke(d, [jit(p) for p in arc(160, 128, 52, 18, math.pi*0.15, math.pi*0.95, 30)][::-1], 5, ink)
    # o
    stroke(d, [jit(p) for p in arc(262, 155, 26, 30, 0, math.tau, 48)], 5, ink)
    # n
    stroke(d, [jit(p) for p in [(300, 128), (296, 200)]], 5, ink)
    stroke(d, [jit(p) for p in [(300, 135)] + arc(322, 135, 22, 26, -math.pi/2, math.pi*0.55, 28) + [(340, 165), (342, 200)]], 5, ink)
    # e
    stroke(d, [jit(p) for p in arc(392, 158, 28, 26, math.pi*0.9, math.pi*2.1, 40)], 5, ink)
    stroke(d, [jit(p) for p in [(368, 152), (414, 146), (430, 175), (445, 200)]], 4, ink)
    # y — long descender
    stroke(d, [jit(p) for p in [(452, 125), (462, 175), (470, 195)]], 5, ink)
    stroke(d, [jit(p) for p in [(500, 122), (478, 195), (462, 238), (445, 248), (432, 240)]], 5, ink)
    # flourish sweep under the word
    stroke(d, [jit(p) for p in [(445, 205), (520, 218), (600, 210), (660, 185), (690, 160), (700, 175), (680, 205)]], 4, ink)
    # dotted heart over the i-position (romantic touch)
    hx, hy = 250, 78
    heart = [(hx, hy+8)] + arc(hx-6, hy, 6, 6, math.pi, 0, 12) + arc(hx+6, hy, 6, 6, math.pi, 0, 12)
    d.polygon(heart, fill=(206, 120, 140, 255))
    img.save(path)

make_deep("img/signature-deep.png")
make_honey("img/signature-honey.png")
print("signatures written")
