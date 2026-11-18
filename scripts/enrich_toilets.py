"""공중화장실 표준데이터 CSV(data/raw/공중화장실정보.csv) → bml_places(toilet) 매칭·신규 적재.

CSV에는 좌표가 없어(주소만 있음) 허브 인근 시군구 행만 카카오 주소 검색으로 지오코딩(캐시: scripts/out/toilet_geocode.json)한다.
  1) 기존 toilet 행과 좌표(40m 이내, 또는 80m 이내+상호 유사)로 매칭 → 개방시간(hours:)·편의시설(facility:)·요약·태그 갱신
  2) 매칭 안 되고 36개 거점 반경 2km 안이면 신규 적재(insert-only, kakao_id='pub-toilet:{관리번호}')
미개방·이동/간이 화장실은 제외. 개방시간이 불명확하면 만들지 않는다('#이용시간확인' 유지).

    python scripts/enrich_toilets.py --dry-run     # 파싱·매칭 통계만
    python scripts/enrich_toilets.py               # 지오코딩 + DB 반영
"""
from __future__ import annotations

import argparse
import csv
import difflib
import json
import math
import re
import sys
import time

import requests

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
import collect_data as cd  # noqa: E402

CSV_PATH = cd.ROOT / "data" / "raw" / "공중화장실정보.csv"
OUT = cd.ROOT / "scripts" / "out"
GEO_CACHE = OUT / "toilet_geocode.json"
DISTRICTS = OUT / "hub_districts.json"
HOURS_PREFIX, FAC_PREFIX = "hours:", "facility:"
HEADERS = {"Authorization": f"KakaoAK {cd.KAKAO_KEY}"}
RANGE_RING = [(0, 0), (0.011, 0), (-0.011, 0), (0.0055, 0.0145), (0.0055, -0.0145), (-0.0055, 0.0145), (-0.0055, -0.0145)]


def district_key(addr: str) -> str | None:
    t = (addr or "").split()
    if len(t) < 2:
        return None
    k = t[0][:2] + " " + t[1]
    if t[1].endswith("시") and len(t) > 2 and t[2].endswith("구"):
        k += " " + t[2]
    return k


def hub_districts() -> set[str]:
    """허브 + 주변 6방향 좌표의 행정동 → 시군구 집합 (CSV 지오코딩 대상을 줄이는 용도)."""
    if DISTRICTS.exists():
        return set(json.loads(DISTRICTS.read_text(encoding="utf-8")))
    out: set[str] = set()
    for lat, lng in cd.HUBS.values():
        for dla, dlo in RANGE_RING:
            r = requests.get(
                "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json",
                headers=HEADERS, params={"x": lng + dlo * 1.3, "y": lat + dla * 1.3}, timeout=10,
            ).json()
            for d in r.get("documents", []):
                if d["region_type"] == "H":
                    out.add(d["region_1depth_name"][:2] + " " + d["region_2depth_name"])
    OUT.mkdir(exist_ok=True)
    DISTRICTS.write_text(json.dumps(sorted(out), ensure_ascii=False), encoding="utf-8")
    return out


# ───────────── 개방시간 파싱 ─────────────
_DASH = r"\s*[~∼～\-–]\s*"
R_COLON = re.compile(rf"(\d{{1,2}}):(\d{{2}}){_DASH}(\d{{1,2}}):(\d{{2}})")
R_4DIG = re.compile(rf"(?<!\d)(\d{{2}})(\d{{2}}){_DASH}(\d{{2}})(\d{{2}})(?!\d)")
R_HOUR = re.compile(rf"(?<!\d)(\d{{1,2}})\s*시?{_DASH}(\d{{1,2}})\s*시")
R_HOUR2 = re.compile(rf"(?<!\d)(\d{{1,2}}){_DASH}(\d{{1,2}})(?!\d|:)")
ALWAYS = re.compile(r"24\s*시간|^24$|상시|연중\s*무휴|24시")


def _fmt(h: int, m: int) -> str:
    return f"{h:02d}:{m:02d}"


def parse_hours(kind: str, detail: str) -> str | None:
    """→ '24시간' | 'HH:MM~HH:MM' | '평일 HH:MM~HH:MM' | None(모름)."""
    s = (detail or "").strip()
    m = None
    for rx in (R_COLON, R_4DIG, R_HOUR, R_HOUR2):
        m = rx.search(s)
        if m:
            g = [int(x) for x in m.groups()]
            if rx in (R_COLON, R_4DIG):
                sh, sm, eh, em = g
            else:
                sh, sm, eh, em = g[0], 0, g[1], 0
            break
    if m:
        if not (0 <= sh <= 24 and 0 <= eh <= 24 and 0 <= sm < 60 and 0 <= em < 60):
            return None
        if (sh, sm) == (eh, em) and sh in (0, 24):
            return "24시간"
        if (sh, sm) == (0, 0) and (eh, em) in ((24, 0), (23, 59)):
            return "24시간"
        if (sh, sm) == (eh, em):
            return None
        weekday = bool(re.search(r"평일|월\s*[~\-]\s*금", s[: m.start()]))
        return ("평일 " if weekday else "") + f"{_fmt(sh, sm)}~{_fmt(eh, em)}"
    if ALWAYS.search(s):
        return "24시간"
    if not s and kind == "상시":
        return "24시간"
    return None


def facilities(r: dict) -> list[str]:
    out: list[str] = []
    n = lambda k: int(r[k]) if (r.get(k) or "").strip().isdigit() else 0  # noqa: E731
    if n("남성용-장애인용대변기수") + n("남성용-장애인용소변기수") + n("여성용-장애인용대변기수") > 0:
        out.append("장애인화장실")
    if r.get("기저귀교환대유무") == "Y":
        out.append("기저귀교환대")
    if r.get("비상벨설치여부") == "Y":
        out.append("비상벨")
    return out


FAC_TAG = {"장애인화장실": "#장애인화장실", "기저귀교환대": "#기저귀교환대", "비상벨": "#비상벨있음"}


def hours_tag(h: str) -> str:
    if h == "24시간":
        return "#24시간개방"
    body = h.replace("평일 ", "")
    s, e = body.split("~")
    if s.endswith(":00") and e.endswith(":00"):
        return f"#{int(s[:2])}~{int(e[:2])}시"
    return f"#{body}"


def build_fields(r: dict, existing_tags: list[str] | None) -> dict:
    hours = parse_hours(r["개방시간"], r["개방시간상세"])
    facs = facilities(r)
    first = "#공중화장실" if r["구분명"] == "공중화장실" else "#개방화장실"
    if existing_tags and existing_tags[0] in ("#공중화장실", "#개방화장실"):
        first = existing_tags[0]
    tags = [first, hours_tag(hours) if hours else "#이용시간확인", FAC_TAG[facs[0]] if facs else "#청결현장확인"]
    extra = ([HOURS_PREFIX + hours] if hours else []) + [FAC_PREFIX + f for f in facs]
    sp = {"장애인화장실": "장애인 화장실", "기저귀교환대": "기저귀 교환대", "비상벨": "비상벨"}
    fac_txt = "·".join(sp[f] for f in facs)
    if hours:
        summary = f"{hours} 개방" + (f", {fac_txt} 있음." if fac_txt else ".")
    else:
        summary = "개방·공중화장실이에요. 이용 가능 시간은 현장 안내를 확인하세요." + (f" {fac_txt} 있음." if fac_txt else "")
    return {"tags": tags, "extra": extra, "summary": summary, "hours": hours}


# ───────────── 지오코딩 ─────────────
def geocode(addr: str) -> tuple[float, float] | None:
    for _ in range(3):
        r = requests.get("https://dapi.kakao.com/v2/local/search/address.json", headers=HEADERS,
                         params={"query": addr, "size": 1}, timeout=10)
        if r.status_code == 429:
            time.sleep(1.5)
            continue
        if r.status_code != 200:
            return None
        docs = r.json().get("documents", [])
        return (float(docs[0]["y"]), float(docs[0]["x"])) if docs else None
    return None


def haversine(a: float, b: float, c: float, d: float) -> float:
    p = math.pi / 180
    x = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return 12742000 * math.asin(math.sqrt(x))


def norm_name(n: str) -> str:
    return re.sub(r"(공중|개방|공공)?화장실|[\s()·\-]", "", n or "")


def similar(a: str, b: str) -> bool:
    a, b = norm_name(a), norm_name(b)
    if not a or not b:
        return False
    return a in b or b in a or difflib.SequenceMatcher(None, a, b).ratio() >= 0.5


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with open(CSV_PATH, encoding="cp949", newline="") as fh:
        all_rows = list(csv.DictReader(fh))
    dist = hub_districts()
    cands = [
        r for r in all_rows
        if r["구분명"] in ("공중화장실", "개방화장실") and r["개방시간"] != "미개방"
        and district_key(r["소재지도로명주소"] or r["소재지지번주소"]) in dist
    ]
    print(f"CSV {len(all_rows)}행 → 허브 인근 시군구 후보 {len(cands)}행")
    hours_ok = sum(parse_hours(r["개방시간"], r["개방시간상세"]) is not None for r in cands)
    print(f"  개방시간 파싱 성공 {hours_ok}행 ({hours_ok * 100 // max(len(cands), 1)}%)")

    OUT.mkdir(exist_ok=True)
    cache: dict[str, list[float] | None] = json.loads(GEO_CACHE.read_text(encoding="utf-8")) if GEO_CACHE.exists() else {}
    todo = [r for r in cands if r["관리번호"] not in cache]
    print(f"  지오코딩 대기 {len(todo)}행 (캐시 {len(cache)})")
    for i, r in enumerate(todo, 1):
        pt = geocode(r["소재지도로명주소"]) or (geocode(r["소재지지번주소"]) if r["소재지지번주소"] else None)
        cache[r["관리번호"]] = list(pt) if pt else None
        if i % 500 == 0:
            GEO_CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
            print(f"  geocode {i}/{len(todo)}", flush=True)
    GEO_CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")

    from supabase import create_client
    client = create_client(cd.SUPABASE_URL, cd.SERVICE_KEY)
    existing: list[dict] = []
    off = 0
    while True:
        chunk = client.table("bml_places").select("id,kakao_id,name,lat,lng,tags,extra").eq("category", "toilet").range(off, off + 999).execute().data
        existing += chunk
        off += 1000
        if len(chunk) < 1000:
            break
    print(f"기존 toilet {len(existing)}행")

    hubs = list(cd.HUBS.values())
    updates: dict[str, dict] = {}  # existing id -> (dist, fields)
    best_d: dict[str, float] = {}
    inserts: list[dict] = []
    seen_new: list[tuple[float, float, str]] = []
    no_geo = 0
    for r in cands:
        pt = cache.get(r["관리번호"])
        if not pt:
            no_geo += 1
            continue
        lat, lng = pt
        # 가장 가까운 기존 행
        best, bd = None, 1e9
        for e in existing:
            if abs(e["lat"] - lat) > 0.0012 or abs(e["lng"] - lng) > 0.0016:
                continue
            d = haversine(lat, lng, e["lat"], e["lng"])
            if d < bd:
                best, bd = e, d
        matched = best is not None and (bd <= 40 or (bd <= 80 and similar(r["화장실명"], best["name"])))
        if matched:
            if bd < best_d.get(best["id"], 1e9):
                best_d[best["id"]] = bd
                f = build_fields(r, best["tags"])
                old_extra = [x for x in (best["extra"] or []) if not x.startswith((HOURS_PREFIX, FAC_PREFIX))]
                updates[best["id"]] = {"tags": f["tags"], "summary": f["summary"], "extra": sorted(set(old_extra + f["extra"])), "_h": f["hours"]}
            continue
        if min(haversine(lat, lng, la, lo) for la, lo in hubs) > 2000:
            continue
        nm = r["화장실명"].strip()
        if any(abs(lat - a) < 0.00015 and abs(lng - b) < 0.0002 and norm_name(nm) == c for a, b, c in seen_new):
            continue
        seen_new.append((lat, lng, norm_name(nm)))
        f = build_fields(r, None)
        inserts.append({
            "kakao_id": f"pub-toilet:{r['관리번호']}", "mode": "survival", "category": "toilet",
            "extra": f["extra"], "name": nm if "화장실" in nm else f"{nm} 화장실",
            "address": r["소재지도로명주소"] or r["소재지지번주소"], "phone": (r["전화번호"] or None),
            "place_url": None, "badge": "화장실", "tags": f["tags"], "summary": f["summary"],
            "lat": lat, "lng": lng, "source": "public",
        })
    with_hours_upd = sum(1 for u in updates.values() if u["_h"])
    with_hours_new = sum(1 for i in inserts if any(x.startswith(HOURS_PREFIX) for x in i["extra"]))
    print(f"지오코딩 실패 {no_geo} / 기존 행 매칭 {len(updates)}(개방시간 {with_hours_upd}) / 신규 {len(inserts)}(개방시간 {with_hours_new})")
    if args.dry_run:
        return 0

    for i, (pid, u) in enumerate(updates.items(), 1):
        u = {k: v for k, v in u.items() if k != "_h"}
        client.table("bml_places").update(u).eq("id", pid).execute()
        if i % 300 == 0:
            print(f"  update {i}/{len(updates)}", flush=True)
    for i in range(0, len(inserts), 200):
        client.table("bml_places").upsert(inserts[i:i + 200], on_conflict="kakao_id", ignore_duplicates=True).execute()
    print("완료")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
