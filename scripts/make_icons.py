"""PWA 아이콘 생성: python scripts/make_icons.py  (Pillow 필요)"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
BLUE, YELLOW, WHITE = (11, 95, 255), (255, 214, 10), (255, 255, 255)
FONT = "C:/Windows/Fonts/arialbd.ttf"


def icon(size: int, maskable: bool) -> Image.Image:
    s = size * 4  # 슈퍼샘플링
    img = Image.new("RGBA", (s, s), BLUE if maskable else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if not maskable:
        d.rounded_rectangle((0, 0, s, s), radius=int(s * 0.22), fill=BLUE)
    scale = 0.62 if maskable else 0.78  # maskable은 중앙 80% 안전영역 안에 로고
    font = ImageFont.truetype(FONT, int(s * 0.62 * scale / 0.78))
    bbox = d.textbbox((0, 0), "B", font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((s - w) / 2 - bbox[0], (s - h) / 2 - bbox[1] - s * 0.02), "B", font=font, fill=WHITE)
    r = int(s * 0.07 * scale / 0.78)
    cx, cy = int(s / 2 + w / 2 + s * 0.02), int(s / 2 - h / 2 - s * 0.04)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=YELLOW)
    return img.resize((size, size), Image.LANCZOS)


for name, size, maskable in [
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("icon-maskable-512.png", 512, True),
    ("apple-touch-icon.png", 180, True),  # iOS는 투명 배경을 검게 채우므로 꽉 찬 사각형
]:
    icon(size, maskable).convert("RGB" if maskable else "RGBA").save(OUT / name)
    print("saved", name)
