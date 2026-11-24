"""브랜드 에셋 생성: python scripts/make_icons.py  (Pillow 필요)
- PWA 아이콘(딥 브라운 #8A3B12 + 크림 #FAF4E8 'B'): public/icons/*, public/apple-touch-icon.png
- iOS 시작 화면(apple-touch-startup-image): public/splash/apple-splash-{w}x{h}.png (에디토리얼 스플래시와 같은 구성)
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent / "public"
BROWN, BROWN_HI, BROWN_LO = (138, 59, 18), (160, 76, 30), (112, 45, 12)
CREAM, GOLD = (250, 244, 232), (200, 150, 62)
INK, MUTED, LABEL, SAND = (43, 26, 14), (107, 87, 68), (110, 52, 16), (230, 217, 192)
NOTO = "C:/Windows/Fonts/NotoSansKR-VF.ttf"


def font(px: float, weight: int) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(NOTO, max(1, round(px)))
    f.set_variation_by_axes([weight])
    return f


def glow(size, spots):
    """cream 바탕 위에 앰버/테라코타 방사형 글로우(저해상도로 그려 블러 후 확대)"""
    w, h = size
    sw, sh = max(1, w // 6), max(1, h // 6)
    base = Image.new("RGB", (sw, sh), CREAM)
    for cx, cy, rx, ry, col, alpha in spots:
        layer = Image.new("L", (sw, sh), 0)
        ImageDraw.Draw(layer).ellipse(
            ((cx - rx) * sw, (cy - ry) * sh, (cx + rx) * sw, (cy + ry) * sh), fill=int(255 * alpha)
        )
        layer = layer.filter(ImageFilter.GaussianBlur(sw * 0.22))
        base = Image.composite(Image.new("RGB", (sw, sh), col), base, layer)
    return base.resize((w, h), Image.BICUBIC)


def b_emblem(img: Image.Image, cx: float, cy: float, box: float):
    """크림 'B' + 은은한 그림자 + 골드 점. box = B 글자 높이 기준 크기"""
    f = font(box, 800)
    d = ImageDraw.Draw(img)
    bb = d.textbbox((0, 0), "B", font=f)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    x, y = cx - w / 2 - bb[0], cy - h / 2 - bb[1]
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).text((x, y + box * 0.03), "B", font=f, fill=(60, 20, 0, 110))
    sh = sh.filter(ImageFilter.GaussianBlur(box * 0.025))
    img.alpha_composite(sh)
    ImageDraw.Draw(img).text((x, y), "B", font=f, fill=CREAM)
    r = box * 0.06
    px, py = cx + w / 2 + box * 0.07, cy - h / 2 + box * 0.02
    ImageDraw.Draw(img).ellipse((px - r, py - r, px + r, py + r), fill=GOLD)


def icon(size: int, kind: str) -> Image.Image:
    s = size * 4
    grad = Image.new("RGB", (1, s))
    for y in range(s):
        t = y / (s - 1)
        grad.putpixel((0, y), tuple(round(BROWN_HI[i] * (1 - t) + BROWN_LO[i] * t) for i in range(3)))
    img = grad.resize((s, s)).convert("RGBA")
    if kind != "maskable":  # 가장자리 얇은 하이라이트 링(입체감, 알파 합성). maskable 은 OS 가 자르므로 생략
        ring = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        inset = s * 0.045
        ImageDraw.Draw(ring).rounded_rectangle((inset, inset, s - inset, s - inset), radius=s * 0.18, outline=(255, 235, 205, 38), width=max(2, s // 170))
        img = Image.alpha_composite(img, ring)
    # maskable·apple 은 꽉 찬 사각형(OS 가 모양을 만든다), any 는 둥근 모서리 + 투명
    if kind == "any":
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, s, s), radius=s * 0.22, fill=255)
        img.putalpha(mask)
    box = s * (0.46 if kind == "maskable" else 0.52)  # maskable 안전 영역(중앙 80%) 안에 B+점이 들어가게
    b_emblem(img, s / 2 - box * 0.02, s / 2 + box * 0.0, box)
    out = img.resize((size, size), Image.LANCZOS)
    return out if kind == "any" else out.convert("RGB")


SPLASH = [  # (css 너비, css 높이, dpr)
    (375, 667, 2), (375, 812, 3), (414, 736, 3), (414, 896, 2), (414, 896, 3),
    (390, 844, 3), (393, 852, 3), (402, 874, 3), (428, 926, 3), (430, 932, 3), (440, 956, 3),
]


def wrap(d, text, f, maxw):
    lines, cur = [], ""
    for word in text.split(" "):
        t = (cur + " " + word).strip()
        if d.textlength(t, font=f) <= maxw or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = word
    lines.append(cur)
    if len(lines) > 1:  # 마지막 줄에 한 단어만 남는 고아 줄 방지: 줄 수를 유지하는 가장 좁은 폭으로 다시 줄바꿈
        n, lo, hi = len(lines), maxw * 0.5, maxw
        for _ in range(12):
            mid = (lo + hi) / 2
            if len(wrap_plain(d, text, f, mid)) <= n:
                hi = mid
            else:
                lo = mid
        return wrap_plain(d, text, f, hi)
    return lines


def wrap_plain(d, text, f, maxw):
    lines, cur = [], ""
    for word in text.split(" "):
        t = (cur + " " + word).strip()
        if d.textlength(t, font=f) <= maxw or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = word
    return lines + [cur]


def tracked(d, x, base, text, f, fill, ls):
    for ch in text:
        d.text((x, base), ch, font=f, fill=fill, anchor="ls")
        x += d.textlength(ch, font=f) + ls
    return x


def splash(cw: int, ch: int, k: int) -> Image.Image:
    W, H = cw * k, ch * k
    img = glow((W, H), [(1.0, 0.0, 0.6, 0.38, (205, 125, 62), 0.34), (0.0, 1.0, 0.6, 0.38, (180, 86, 40), 0.28)])
    d = ImageDraw.Draw(img, "RGBA")
    pad, innerw = 28 * k, min(cw - 56, 420) * k
    x0 = (W - innerw) / 2
    fl, fh, fd, fc, fs = font(12 * k, 700), font(28 * k, 800), font(14.5 * k, 500), font(12 * k, 700), font(12 * k, 500)
    DESC = "광고 없이 발품과 데이터로 검증한 내 주변 진짜 동네 지도"
    for px in (14.5, 14, 13.5, 13):  # 한 줄에 들어가는 가장 큰 글자 크기(앱 스플래시는 Pretendard 라 더 좁게 한 줄로 보인다)
        fd = font(px * k, 500)
        if d.textlength(DESC, font=fd) <= innerw:
            break
    desc = wrap(d, DESC, fd, innerw)
    head_lh, desc_lh, caps_h = 35 * k, 22.5 * k, 32 * k
    total = 36 * k + 28 * k + 2 * head_lh + 14 * k + len(desc) * desc_lh + 22 * k + caps_h
    y = (H - total) / 2
    # 브랜드 줄
    d.rounded_rectangle((x0, y, x0 + 36 * k, y + 36 * k), radius=10 * k, fill=BROWN)
    fb = font(20 * k, 800)
    d.text((x0 + 18 * k, y + 18 * k), "B", font=fb, fill=(255, 248, 236), anchor="mm")
    tracked(d, x0 + 46 * k, y + 18 * k + 4.2 * k, "BRAVO MY LIFE", fl, LABEL, 12 * k * 0.22)
    y += 36 * k + 28 * k
    # 헤드라인(2줄, 강조어만 브라운)
    for segs in ([("지금 필요한 ", INK), ("생존", BROWN), ("부터", INK)], [("세월이 증명한 ", INK), ("찐노포", BROWN), ("까지.", INK)]):
        x, base = x0, y + head_lh / 2 + 10 * k
        for t, col in segs:
            x = tracked(d, x, base, t, fh, col, -0.03 * 28 * k)
        y += head_lh
    y += 14 * k
    for ln in desc:
        d.text((x0, y + desc_lh / 2 + 5 * k), ln, font=fd, fill=MUTED, anchor="ls")
        y += desc_lh
    y += 22 * k
    # 캡슐 2개
    x = x0
    for t in ("24시 긴급 생존 인프라", "업력 10년+ 검증 노포"):
        tw = d.textlength(t, font=fc)
        d.rounded_rectangle((x, y, x + tw + 24 * k, y + caps_h), radius=caps_h / 2, fill=(255, 253, 247, 178), outline=SAND, width=max(1, k))
        d.text((x + 12 * k, y + caps_h / 2 + 4.2 * k), t, font=fc, fill=LABEL, anchor="ls")
        x += tw + 24 * k + 8 * k
    # 하단 트랙 + 문구
    fy = H - (36 + 34) * k - 31 * k
    d.rounded_rectangle((x0, fy, x0 + innerw, fy + 2 * k), radius=k, fill=(138, 59, 18, 38))
    sub = "내 손안의 동네 생존 & 찐노포 가이드"
    d.text((W / 2, fy + 14 * k + 12 * k), sub, font=fs, fill=MUTED, anchor="ms")
    return img.convert("RGB")


if __name__ == "__main__":
    for name, size, kind in [
        ("icons/icon-192.png", 192, "any"),
        ("icons/icon-512.png", 512, "any"),
        ("icons/icon-maskable-512.png", 512, "maskable"),
        ("icons/apple-touch-icon.png", 180, "apple"),
        ("apple-touch-icon.png", 180, "apple"),
    ]:
        icon(size, kind).save(ROOT / name, optimize=True)
        print("saved", name)
    (ROOT / "splash").mkdir(exist_ok=True)
    for cw, ch, k in SPLASH:
        n = f"splash/apple-splash-{cw * k}x{ch * k}.png"
        splash(cw, ch, k).save(ROOT / n, optimize=True)
        print("saved", n)
