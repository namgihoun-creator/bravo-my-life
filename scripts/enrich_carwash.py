"""세차장정보 CSV(data/raw/세차장정보.csv) → bml_places(mode='survival', category='carwash') 적재.

36개 거점 반경 2km 안의 세차장만 insert-only(kakao_id='pub-carwash:{관리번호}')로 넣는다.
  extra : type:셀프세차 | hours:09:00~18:00 | closed:일요일·공휴일
  tags  : [세차유형, 운영시간, 휴무] (3개)
  feedback.closed_days : 매주 같은 요일 휴무(예: 일요일)만 ['일'] 로 넣어 '오늘 정기휴무'를 판별한다.
'연중무휴'는 openStatus 가 24시간 운영으로 오인하므로 요약·태그에 쓰지 않는다.

    python scripts/enrich_carwash.py --dry-run
    python scripts/enrich_carwash.py
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import Counter

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
import collect_data as cd  # noqa: E402
from enrich_toilets import haversine  # noqa: E402

CSV_PATH = cd.ROOT / "data" / "raw" / "세차장정보.csv"
DAYS = "월화수목금토일"
EMPTY = {"", "0", "-", "없음", "데이터 없음", "해당없음", "해당 없음"}


def clean_name(n: str) -> str:
    """'이화주유소[임차 상호: 이화주유소]' 같은 대괄호 주석을 걷어낸다."""
    return re.sub(r"\s*[\[(][^\])]*(임차|상호|구\s*:)[^\])]*[\])]", "", n or "").strip() or (n or "").strip()


def wash_type(r: dict) -> str:
    t, name = (r["세차유형"] or "").strip(), r["사업장명"]
    if "셀프" in t or "셀프" in name:
        return "셀프세차"
    if "손" in t or "손세차" in name or "핸드" in name:
        return "손세차"
    if t in ("자동세차", "자동식") or "자동세차" in name or "자동" in t and "자동차" not in t:
        return "자동세차"
    return "세차장"


def _hm(s: str) -> str | None:
    m = re.fullmatch(r"\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*", s or "")
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else None


def hours_text(r: dict) -> str | None:
    wd = (_hm(r["평일운영시작시각"]), _hm(r["평일운영종료시각"]))
    hd = (_hm(r["휴일운영시작시각"]), _hm(r["휴일운영종료시각"]))

    def span(p: tuple[str | None, str | None]) -> str | None:
        if not p[0] or not p[1]:
            return None
        if p[0] == p[1] and p[0] in ("00:00", "24:00"):
            return "24시간"
        if p[0] == "00:00" and p[1] in ("24:00", "23:59"):
            return "24시간"
        return None if p[0] == p[1] else f"{p[0]}~{p[1]}"

    w, h = span(wd), span(hd)
    if w and h:
        return w if w == h else f"평일 {w} · 휴일 {h}"
    if w:
        return f"평일 {w}" if w != "24시간" else w
    return h if h == "24시간" else (f"휴일 {h}" if h else None)


def closed_info(r: dict) -> tuple[str | None, list[str]]:
    """→ (표시 문구 '일요일·공휴일', 매주 휴무 요일 ['일'])"""
    s = (r["휴무일"] or "").strip()
    if s in EMPTY or re.search(r"연중\s*무휴|무휴|휴무\s*없", s):
        return None, []
    nth = bool(re.search(r"첫째|둘째|셋째|넷째|마지막|격주|\d\s*째|\d주", s))
    days: list[str] = []
    if not nth:
        found = re.findall(r"([월화수목금토일])\s*요일", s) + re.findall(r"매주\s*([월화수목금토일])(?!요)", s)
        days = [d for d in DAYS if d in set(found)]
    parts = [f"{d}요일" for d in days]
    if "공휴일" in s or "명절" in s:
        parts.append("공휴일")
    if not parts:
        return None, []  # 해석 불가한 자유 문구는 표시하지 않는다
    return ("·".join(parts) if not nth else f"{'·'.join(parts)}(격주·일부)"), days


def hours_tag(h: str) -> str:
    if h == "24시간":
        return "#24시간"
    body = h.split(" · ")[0].replace("평일 ", "").replace("휴일 ", "")
    s, e = body.split("~")
    return f"#{int(s[:2])}~{int(e[:2])}시" if s.endswith(":00") and e.endswith(":00") else f"#{body}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    with open(CSV_PATH, encoding="cp949", newline="") as fh:
        rows = list(csv.DictReader(fh))
    hubs = list(cd.HUBS.values())
    out: list[dict] = []
    for r in rows:
        try:
            lat, lng = float(r["WGS84위도"]), float(r["WGS84경도"])
        except ValueError:
            continue
        if not (33 < lat < 39 and 124 < lng < 132):
            continue
        if min(haversine(lat, lng, a, b) for a, b in hubs) > 2000:
            continue
        typ = wash_type(r)
        hours = hours_text(r)
        closed_txt, closed_days = closed_info(r)
        extra = [f"type:{typ}"] + ([f"hours:{hours}"] if hours else []) + ([f"closed:{closed_txt}"] if closed_txt else [])
        tags = [f"#{typ}", hours_tag(hours) if hours else "#운영시간확인",
                f"#{closed_txt.split('·')[0].replace('요일', '')}요일휴무" if closed_txt and closed_days else ("#휴무일확인")]
        bits = [f"{typ}이에요." if typ != "세차장" else "세차장이에요."]
        if hours:
            bits.append(f"{hours} 운영.")
        if closed_txt:
            bits.append(f"{closed_txt} 휴무.")
        if not hours:
            bits.append("운영시간은 방문 전 전화로 확인하세요.")
        out.append({
            "kakao_id": f"pub-carwash:{r['관리번호']}", "mode": "survival", "category": "carwash",
            "extra": extra, "name": clean_name(r["사업장명"]),
            "address": r["소재지도로명주소"] or r["소재지지번주소"], "phone": r["세차장전화번호"] or None,
            "place_url": None, "badge": "세차", "tags": tags[:3], "summary": " ".join(bits),
            "lat": lat, "lng": lng, "source": "public",
            "feedback": {"closed_days": closed_days} if closed_days else {},
        })
    types = Counter(next(e[5:] for e in o["extra"] if e.startswith("type:")) for o in out)
    print(f"CSV {len(rows)}행 → 거점 2km 안 {len(out)}곳  유형 {dict(types)}")
    print(f"  운영시간 {sum(any(e.startswith('hours:') for e in o['extra']) for o in out)}곳, 휴무 {sum(any(e.startswith('closed:') for e in o['extra']) for o in out)}곳")
    for o in out[:3]:
        print("  예)", o["name"], o["tags"], o["extra"], o["summary"])
    if args.dry_run:
        return 0
    from supabase import create_client
    client = create_client(cd.SUPABASE_URL, cd.SERVICE_KEY)
    for i in range(0, len(out), 200):
        client.table("bml_places").upsert(out[i:i + 200], on_conflict="kakao_id", ignore_duplicates=True).execute()
        print(f"  upsert {min(i + 200, len(out))}/{len(out)}")
    print("완료")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
