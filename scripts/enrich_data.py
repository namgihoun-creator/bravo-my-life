"""공공데이터로 노포 업력 검증 + 공영주차장 요금·운영시간 매칭.

입력(data/raw/):
    식품_일반음식점.csv            (전국 일반음식점 인허가, 약 700MB → csv 모듈로 스트리밍)
    전국주차장정보표준데이터.csv     (전국 주차장 정보)

[1] 노포 (mode='nopo')
    - CSV에서 서울·경기 + 영업 중인 행만, 그것도 DB 노포 상호명과 일치하는 행만 메모리에 적재
    - 상호명 + 구/도로명주소로 매칭해 인허가일자 → 업력 계산
    - 같은 상호가 3개 이상 구에 있으면 프랜차이즈로 삭제 / 업력 10년 미만이면 삭제
    - 업력 10년 이상은 '진짜 노포'로 확정(open_year, 뱃지 '업력 N년', 20년 이상은 veteran 필터)
    - 확정 노포는 카카오 블로그 검색으로 광고 비율을 보고(절반 이상이면 삭제) 요약·태그 갱신
      (CLAUDE.md 저작권 규칙: 블로그 문장은 옮기지 않고 키워드만 집계해 직접 쓴 문장으로 요약)
    - CSV에서 못 찾은 후보는 그대로 둔다 (검증 불가 ≠ 가짜)

[2] 공영주차장 (category='parking')
    - 서울·경기 '공영' 주차장 CSV와 좌표(+이름 유사도)로 매칭해 요금·운영시간 태그/요약 갱신

[4] 업종 분류 (--classify): 검증 노포를 위생업태명+상호 키워드로 분류해 extra('food:한식 · 고기·구이'), 태그(업종 태그 앞쪽),
    요약('2011년 개업 · 한식(고기·구이) 전문점이에요.')을 갱신 — 뱃지(업력 N년)와 겹치는 문구 제거
[3] 2차 매칭 (--pass2): open_year가 빈 노포를 '정규화 주소 정확 일치 + 인허가 10년 이상 + 상호 핵심명 일치'로 추가 확정

사용법:  python scripts/enrich_data.py [--dry-run] [--skip-nopo] [--skip-parking] [--no-blog] [--pass2]
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
import enrich_nopo as blog  # noqa: E402  (analyze / MENUS / AUTH 키워드 재사용)

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local")
SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

RAW = ROOT / "data" / "raw"
RESTAURANT_CSV = RAW / "식품_일반음식점.csv"
PARKING_CSV = RAW / "전국주차장정보표준데이터.csv"
OUT = ROOT / "scripts" / "out"
EXCLUDED_FILE = ROOT / "scripts" / "data" / "nopo_excluded.json"
OPEN_YEARS_FILE = ROOT / "scripts" / "data" / "open_years.json"

REGIONS = ("서울특별시", "경기도", "인천광역시")  # 부평역 거점 때문에 인천 포함
TODAY_YEAR = date.today().year
MIN_AGE = 10  # 업력 10년 이상(인허가 2016년 이전)


# ───────────────────────── 공통 ─────────────────────────
def detect_encoding(path: Path) -> str:
    sample = path.open("rb").read(1_000_000)
    for enc in ("utf-8-sig", "cp949"):
        for cut in range(0, 4):  # 샘플 끝에서 멀티바이트 문자가 잘렸을 수 있음
            try:
                sample[: len(sample) - cut].decode(enc)
                return enc
            except UnicodeDecodeError:
                continue
    return "cp949"


def fetch_all(client, mode_filter: dict, select: str) -> list[dict]:
    rows: list[dict] = []
    off = 0
    while True:
        q = client.table("bml_places").select(select)
        for k, v in mode_filter.items():
            q = q.eq(k, v)
        r = q.range(off, off + 999).execute().data
        rows += r
        if len(r) < 1000:
            return rows
        off += 1000


def norm_name(s: str) -> str:
    return re.sub(r"[\s()\[\]{}·\-_.,&/~!]+", "", s).lower()


def finest_district(addr: str) -> str | None:
    """주소 앞쪽 토큰 중 마지막 '구/군/시' 토큰 (예: 경기 부천시 원미구 → 원미구)."""
    toks = re.sub(r"\(.*?\)", " ", addr).split()[:4]
    found = [t for t in toks[1:] if re.search(r"[가-힣](구|군|시)$", t)]
    return found[-1] if found else None


ROAD_RE = re.compile(r"([가-힣0-9]+(?:로|길))\s*(\d+(?:-\d+)?)")


def road_key(addr: str) -> tuple[str, str] | None:
    m = ROAD_RE.search(re.sub(r"\(.*?\)", " ", addr))
    return (m.group(1), m.group(2)) if m else None


# ───────────────────────── [1] 노포 업력 ─────────────────────────
def load_restaurants(names: set[str]) -> dict[str, list[dict]]:
    enc = detect_encoding(RESTAURANT_CSV)
    print(f"[CSV] {RESTAURANT_CSV.name} 인코딩 {enc} 스트리밍 시작")
    out: dict[str, list[dict]] = defaultdict(list)
    n = kept = 0
    t0 = time.time()
    with RESTAURANT_CSV.open(encoding=enc, newline="") as f:
        r = csv.reader(f)
        h = next(r)
        i_name, i_date = h.index("사업장명"), h.index("인허가일자")
        i_state, i_road, i_jibun = h.index("영업상태명"), h.index("도로명주소"), h.index("지번주소")
        for row in r:
            n += 1
            if len(row) <= i_jibun:
                continue
            road, jibun = row[i_road], row[i_jibun]
            if not any(k in road or k in jibun for k in REGIONS):
                continue
            if not row[i_state].startswith("영업"):
                continue
            key = norm_name(row[i_name])
            if key not in names:
                continue
            m = re.match(r"(\d{4})", row[i_date])
            if not m:
                continue
            kept += 1
            out[key].append(
                {"year": int(m.group(1)), "road": road, "jibun": jibun, "district": finest_district(road or jibun)}
            )
            if n % 1_000_000 == 0:
                print(f"  {n:,}행 처리 ({time.time() - t0:.0f}s), 매칭 후보 {kept:,}")
    print(f"[CSV] 총 {n:,}행 → DB 상호와 일치하는 서울·경기·인천 영업 행 {kept:,}건 ({time.time() - t0:.0f}s)")
    return out


def match_open_year(row: dict, cands: list[dict]) -> int | None:
    """DB 노포 행에 해당하는 인허가 연도 (구 일치 + 도로명번호 일치 우선, 유일할 때만 구 단위 수용)."""
    dist = finest_district(row["address"] or "")
    same = [c for c in cands if c["district"] and c["district"] == dist]
    if not same:
        return None
    rk = road_key(row["address"] or "")
    if rk:
        exact = [c for c in same if road_key(c["road"]) == rk]
        if exact:
            return min(c["year"] for c in exact)
    if len(same) == 1:
        return same[0]["year"]
    return None


def enrich_nopo(client, dry: bool, use_blog: bool) -> None:
    rows = fetch_all(
        client, {"mode": "nopo"}, "id,kakao_id,name,address,lat,lng,category,extra,tags,badge,summary"
    )
    print(f"[노포] DB {len(rows)}건")
    OUT.mkdir(exist_ok=True)
    (OUT / "nopo_backup2.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")

    cand = load_restaurants({norm_name(r["name"]) for r in rows})

    # 프랜차이즈: 같은 상호가 서로 다른 구 3곳 이상
    franchise_keys = {
        k for k, v in cand.items() if len({c["district"] for c in v if c["district"]}) >= 3
    }

    drop: dict[str, str] = {}
    confirmed: list[tuple[dict, int]] = []
    unmatched = 0
    for r in rows:
        key = norm_name(r["name"])
        if key in franchise_keys:
            drop[r["id"]] = "franchise"
            continue
        year = match_open_year(r, cand.get(key, []))
        if year is None:
            unmatched += 1
        elif TODAY_YEAR - year < MIN_AGE:
            drop[r["id"]] = "young"
        else:
            confirmed.append((r, year))

    c = Counter(drop.values())
    print(f"[노포] 프랜차이즈 삭제 {c['franchise']} / 10년 미만 삭제 {c['young']} / "
          f"업력 10년+ 확정 {len(confirmed)} / CSV 미매칭 유지 {unmatched}")

    # 블로그 교차 검증 (광고 과다 제외 + 요약·태그)
    updates: list[tuple[str, dict]] = []
    ad_drop = 0
    analysis: dict[str, dict] = {}
    if use_blog and confirmed:
        with ThreadPoolExecutor(max_workers=4) as ex:
            futs = {ex.submit(blog.analyze, r): r for r, _ in confirmed}
            for f in as_completed(futs):
                analysis[futs[f]["id"]] = f.result()

    for r, year in confirmed:
        age = TODAY_YEAR - year
        a = analysis.get(r["id"])
        if a and a["rel"] >= 3 and a["ad"] * 2 >= a["rel"]:
            drop[r["id"]] = "ad"
            ad_drop += 1
            continue
        extra = sorted(set(r["extra"] or []) | ({"veteran"} if age >= 20 else set()))
        upd = {"badge": f"업력 {age}년", "extra": extra, **build_text(r, a, year, age)}
        updates.append((r["id"], upd))
    print(f"[노포] 블로그 광고 과다 삭제 {ad_drop}, 갱신 {len(updates)}건")
    for rid, u in updates[:6]:
        nm = next(x["name"] for x, _ in confirmed if x["id"] == rid)
        print(f"   ✓ {nm}: {u['badge']} {u['tags']} | {u['summary']}")

    open_years = {r["id"]: y for r, y in confirmed if r["id"] not in drop}
    if dry:
        print("dry-run: DB 변경 없음")
        return

    ids = list(drop)
    for i in range(0, len(ids), 100):
        client.table("bml_places").delete().in_("id", ids[i : i + 100]).execute()
    excluded = {r["kakao_id"] for r in rows if r["id"] in drop and r["kakao_id"]}
    old = set(json.loads(EXCLUDED_FILE.read_text(encoding="utf-8"))) if EXCLUDED_FILE.exists() else set()
    EXCLUDED_FILE.write_text(json.dumps(sorted(old | excluded), ensure_ascii=False), encoding="utf-8")

    has_col = True
    try:
        client.table("bml_places").select("open_year").limit(1).execute()
    except Exception:
        has_col = False
        print("  ! open_year 컬럼이 없어 값을 JSON(scripts/data/open_years.json)에만 저장합니다. "
              "supabase/migrations/002_open_year.sql 실행 후 다시 돌리면 채워집니다.")
    OPEN_YEARS_FILE.write_text(json.dumps(open_years), encoding="utf-8")

    for n, (rid, u) in enumerate(updates, 1):
        if has_col:
            u = {**u, "open_year": open_years[rid]}
        client.table("bml_places").update(u).eq("id", rid).execute()
        if n % 100 == 0:
            print(f"  update {n}/{len(updates)}")
    print(f"[노포] 삭제 {len(ids)}건, 갱신 {len(updates)}건 완료")


def build_text(r: dict, a: dict | None, year: int, age: int) -> dict:
    """요약·태그. 블로그 문장은 옮기지 않고 키워드만 집계한다."""
    tags = [f"#업력{age}년"]
    if not a or len(a["authentic"]) < 2:
        sub = r["tags"][0] if r["tags"] and not r["tags"][0].startswith("#업력") else "#노포"
        tags += [sub, "#후기적음"] if sub != "#노포" else ["#노포", "#후기적음"]
        return {"tags": tags[:3], "summary": f"{year}년 인허가, {age}년째 영업 중인 가게예요. 블로그 후기는 아직 적어요."}

    joined = " ".join(a["authentic"])
    menu_count = Counter(m for t in a["clean"] for m in blog.MENUS if m in t)
    menus = [m for m, _ in menu_count.most_common(2)]
    if "단골" in joined:
        tags.append("#현지인단골")
    if a["ad"] == 0:
        tags.append("#광고적음")
    if any(w in joined for w in blog.OLD_WORDS):
        tags.append("#노포감성")
    if menus:
        tags.append(f"#{menus[0]}")
    tags = list(dict.fromkeys(tags))[:3]
    while len(tags) < 3:
        tags.append("#후기확인")

    what = "·".join(menus) + " 후기에 " if menus else "후기에 "
    who = "단골 언급이 있어요" if "단골" in joined else "오래된 가게라는 언급이 있어요"
    return {"tags": tags, "summary": f"{year}년 개업, {what}{who}."}


# ───────────────────────── [2] 공영주차장 ─────────────────────────
def to_int(s: str) -> int | None:
    s = (s or "").strip().replace(",", "")
    return int(float(s)) if re.fullmatch(r"\d+(\.\d+)?", s) else None


def hhmm(s: str) -> str:
    return (s or "").strip()[:5]


def parking_spec(c: dict) -> dict:
    """CSV 행 → 태그 3개 + 요약."""
    fee_info = (c["요금정보"] or "").strip()
    base_t, base_f = to_int(c["주차기본시간"]), to_int(c["주차기본요금"])
    unit_t, unit_f = to_int(c["추가단위시간"]), to_int(c["추가단위요금"])
    day_f = to_int(c["1일주차권요금"])

    def unit_txt(t: int, f: int) -> str:
        return f"{'1시간' if t == 60 else f'{t}분'}당 {f:,}원"

    if fee_info == "무료":
        fee_tag, fee_txt = "#무료", "무료 주차장"
    elif unit_t and unit_f:
        fee_tag = f"#{'1시간' if unit_t == 60 else f'{unit_t}분'}당{unit_f}원"
        fee_txt = unit_txt(unit_t, unit_f)
    elif base_t and base_f:
        fee_tag = f"#{'1시간' if base_t == 60 else f'{base_t}분'}{base_f}원"
        fee_txt = f"{base_t}분 {base_f:,}원"
    else:
        fee_tag, fee_txt = "#요금현장확인", "요금은 현장 확인"

    s, e = hhmm(c["평일운영시작시각"]), hhmm(c["평일운영종료시각"])
    if s in ("00:00", "") and e in ("23:59", "24:00", "00:00") and s:
        hours_tag, hours_txt = "#24시운영", "24시간 운영"
    elif s and e:
        a, b = str(int(s[:2])), str(int(e[:2]))
        hours_tag, hours_txt = f"#{a}~{b}시", f"평일 {a}~{b}시 운영"
    else:
        hours_tag, hours_txt = "#운영시간확인", "운영시간 확인 필요"

    free_base = (base_f == 0 and (base_t or 0) >= 10 and fee_info != "무료")
    third = "#기본무료" if free_base else None

    summary = f"{fee_txt}, {hours_txt}."
    if day_f:
        summary += f" 하루권 {day_f:,}원."
    return {"fee_tag": fee_tag, "hours_tag": hours_tag, "third": third,
            "type": (c["주차장유형"] or "").strip(), "summary": summary}


def load_parking() -> list[dict]:
    enc = detect_encoding(PARKING_CSV)
    out = []
    with PARKING_CSV.open(encoding=enc, newline="") as f:
        for row in csv.DictReader(f):
            addr = (row["소재지도로명주소"] or "") + " " + (row["소재지지번주소"] or "")
            if not any(k in addr for k in REGIONS):
                continue
            if (row["주차장구분"] or "").strip() != "공영":
                continue
            if "거주자" in (row["주차장명"] or ""):
                continue  # 거주자우선주차장 제외
            try:
                row["lat"], row["lng"] = float(row["위도"]), float(row["경도"])
            except ValueError:
                continue
            out.append(row)
    print(f"[주차장] CSV 서울·경기·인천 공영 {len(out):,}건 (인코딩 {enc})")
    return out


def dist_m(a_lat, a_lng, b_lat, b_lng) -> float:
    dy = (a_lat - b_lat) * 111_000
    dx = (a_lng - b_lng) * 111_000 * math.cos(math.radians(a_lat))
    return math.hypot(dx, dy)


def pk_norm(s: str) -> str:
    return re.sub(r"(공영|주차장|노외|노상|제?\d+호?|\s)", "", s)


TYPE_TAG = {"노외": "#노외주차장", "노상": "#노상주차", "건축물부설": "#건물부설"}
SPECIAL = {"#기계식주의", "#지하주차장", "#노상주차"}


def region_key(addr: str) -> str | None:
    """주소 → 지자체 단위. 서울·인천은 '구', 경기는 '시/군' (예: 경기 부천시 원미구 → 부천시)."""
    toks = re.sub(r"\(.*?\)", " ", addr).split()[:4]
    if not toks:
        return None
    if toks[0].startswith(("서울", "인천")):
        return next((t for t in toks[1:] if re.search(r"구$", t)), None)
    return next((t for t in toks[1:] if re.search(r"[가-힣](시|군)$", t)), None)


def ten_min_price(c: dict) -> float | None:
    ut, uf = to_int(c["추가단위시간"]), to_int(c["추가단위요금"])
    bt, bf = to_int(c["주차기본시간"]), to_int(c["주차기본요금"])
    if ut and uf:
        return uf * 10 / ut
    if bt and bf:
        return bf * 10 / bt
    return None


def region_fee_stats(lots: list[dict]) -> dict[str, tuple[int, int, int]]:
    """지자체별 공영주차장 10분당 요금 범위(하위10%~상위10%, 100원 단위) — 공공데이터에 요금이 있는 곳만, 3곳 이상일 때."""
    by: dict[str, list[float]] = defaultdict(list)
    for c in lots:
        key = region_key((c["소재지도로명주소"] or "") + " " + (c["소재지지번주소"] or "")) or region_key(
            c["소재지지번주소"] or ""
        )
        p = ten_min_price(c)
        if key and p:
            by[key].append(p)
    out = {}
    for k, v in by.items():
        if len(v) >= 3:
            v.sort()
            lo, hi = v[int(len(v) * 0.1)], v[min(len(v) - 1, int(len(v) * 0.9))]
            out[k] = (len(v), max(100, round(lo / 100) * 100), max(100, round(hi / 100) * 100))
    return out


def municipal_summary(region: str | None, stats: dict, hours_txt: str | None) -> str:
    """요금 정보가 없는 지자체 공영주차장 요약. 공공데이터에 근거한 범위만 쓰고, 없으면 '정보 없음'을 솔직히 적는다."""
    name = region or "지자체"
    if region in stats:
        _, lo, hi = stats[region]
        rng = f"{lo}원" if lo == hi else f"{lo}~{hi}원"
        text = f"{name} 공영 10분당 {rng} 수준, 현장 확인 권장."
    else:
        text = f"{name} 공영주차장은 요금 공개 정보가 없어요. 현장 확인 권장."
    if hours_txt and len(text) + len(hours_txt) + 1 <= 50:
        text += f" {hours_txt}."
    return text


def enrich_parking(client, dry: bool) -> None:
    lots = load_parking()
    grid: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for c in lots:
        grid[(int(c["lat"] * 200), int(c["lng"] * 200))].append(c)

    stats = region_fee_stats(lots)
    rows = fetch_all(client, {"category": "parking"}, "id,name,address,lat,lng,tags,summary,badge")
    print(f"[주차장] DB {len(rows)}건")
    updates: list[tuple[str, dict]] = []
    matched = municipal = 0
    for r in rows:
        if "거주자" in r["name"]:
            continue  # 거주자우선주차장은 매칭·보강 대상이 아님 (DB에서도 삭제됨)
        gx, gy = int(r["lat"] * 200), int(r["lng"] * 200)
        near = [
            (dist_m(r["lat"], r["lng"], c["lat"], c["lng"]), c)
            for dx in (-1, 0, 1)
            for dy in (-1, 0, 1)
            for c in grid.get((gx + dx, gy + dy), [])
        ]
        near = [(d, c) for d, c in near if d <= 200]
        best = None
        if near:
            scored = sorted(
                ((SequenceMatcher(None, pk_norm(r["name"]), pk_norm(c["주차장명"])).ratio(), d, c) for d, c in near),
                key=lambda x: (-x[0], x[1]),
            )
            ratio, d, c = scored[0]
            if ratio >= 0.55 or (d <= 60 and len(near) == 1):
                best = c

        tags, summary, hours_txt = list(r["tags"]), r["summary"], None
        if best:
            spec = parking_spec(best)
            cur_special = next((t for t in r["tags"] if t in SPECIAL), None)
            third = spec["third"] or cur_special or TYPE_TAG.get(spec["type"], "#공영주차장")
            tags = list(dict.fromkeys([spec["fee_tag"], spec["hours_tag"], third]))
            while len(tags) < 3:
                tags.append("#공영주차장")
            summary, hours_txt = spec["summary"], spec["summary"].split(", ", 1)[-1].rstrip(".")
            matched += 1

        # 요금이 끝내 비어 있는 '공영' 주차장 → 지자체 공영 태그 + 지자체 단위 안내
        if "#요금현장확인" in tags and (best or "공영" in r["name"]):
            region = region_key(r["address"] or "")
            tags = ["#지자체공영" if t == "#요금현장확인" else t for t in tags]
            summary = municipal_summary(region, stats, hours_txt if best else None)
            municipal += 1
        elif not best:
            continue
        updates.append((r["id"], {"tags": tags[:3], "summary": summary}))

    print(f"[주차장] CSV 매칭 {matched}건, 지자체공영 안내 {municipal}건 → 갱신 {len(updates)}건 / 그대로 {len(rows) - len(updates)}건")
    for rid, u in updates[:6]:
        nm = next(x["name"] for x in rows if x["id"] == rid)
        print(f"   ✓ {nm}: {u['tags']} | {u['summary']}")
    if dry:
        print("dry-run: DB 변경 없음")
        return
    for n, (rid, u) in enumerate(updates, 1):
        client.table("bml_places").update(u).eq("id", rid).execute()
        if n % 100 == 0:
            print(f"  update {n}/{len(updates)}")
    print(f"[주차장] 갱신 {len(updates)}건 완료")


# ───────────────────────── [3] 2차 주소·유사 상호명 매칭 ─────────────────────────
# 1차(상호명 정확 일치)에서 못 찾은 노포 후보 중, '주소가 정확히 같고' 상호 핵심명이 맞는 인허가 행을 찾는다.
JIBUN_RE = re.compile(r"([가-힣0-9]+(?:동|가|리))\s+(\d+(?:-\d+)?)")
GENERIC = {
    "식당", "국밥", "분식", "치킨", "호프", "주점", "포차", "한식", "중국집", "횟집", "고기", "갈비", "김밥",
    "순대", "족발", "보쌈", "곱창", "막창", "술집", "맥주", "이자카야", "파스타", "시장", "마을", "맛집",
    "명가", "가든", "본가", "할머니", "할아버지", "우리", "대박", "형제", "엄마", "아빠", "이모", "삼촌",
    "해장국", "칼국수", "냉면", "찌개", "백반", "닭갈비", "삼겹살", "부대찌개", "감자탕", "설렁탕",
}


def addr_keys(addr: str) -> set[str]:
    """층·호수를 뺀 정규화 주소 키: (구, 도로명, 본번-부번) 또는 (구, 동, 지번)."""
    addr = re.sub(r"\(.*?\)", " ", addr or "")
    dist = finest_district(addr)
    keys: set[str] = set()
    if not dist:
        return keys
    m = ROAD_RE.search(addr)
    if m:
        keys.add(f"R|{dist}|{m.group(1)}|{m.group(2)}")
    m = JIBUN_RE.search(addr)
    if m:
        keys.add(f"J|{dist}|{m.group(1)}|{m.group(2)}")
    return keys


def core_name(s: str) -> str:
    s = re.sub(r"\(주\)|㈜|주식회사", "", s or "")
    s = re.sub(r"\(.*?\)", "", s)
    for w in ("본점", "별관", "원조", "전통"):
        s = s.replace(w, "")
    return re.sub(r"[^0-9A-Za-z가-힣]", "", s)


def longest_common(a: str, b: str) -> str:
    best = ""
    for i in range(len(a)):
        for j in range(i + 2, len(a) + 1):
            sub = a[i:j]
            if len(sub) > len(best) and sub in b:
                best = sub
    return best


def strip_branch(raw: str) -> str:
    """마지막 공백 토큰이 '○○점'이면(지점명) 제거. 예: '신의주찹쌀순대 신촌점' → '신의주찹쌀순대'."""
    parts = re.sub(r"\(.*?\)", " ", raw or "").split()
    if len(parts) > 1 and parts[-1].endswith("점") and len(parts[-1]) <= 8:
        parts = parts[:-1]
    return " ".join(parts)


def names_match(kakao_name: str, csv_name: str) -> bool:
    """핵심 상호명 일치. 지점명·(주)·본점·원조·전통·공백·특수문자를 뺀 뒤,
    ① 완전 일치, ② 3글자 이상 포함 관계, ③ 3글자 이상 연속 일치 + 유사도 0.7 이상.
    (2글자 이하만 겹치는 경우는 같은 건물의 다른 가게일 가능성이 커서 인정하지 않는다)"""
    a, b = core_name(strip_branch(kakao_name)), core_name(strip_branch(csv_name))
    if len(a) < 2 or len(b) < 2:
        return False
    if a == b:
        return True
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    if len(short) >= 3 and short in long_ and short not in GENERIC:
        return True
    common = longest_common(a, b)
    return (
        len(common) >= 3
        and common not in GENERIC
        and not common.isdigit()
        and SequenceMatcher(None, a, b).ratio() >= 0.7
    )


def is_cafe_like(*texts: str) -> bool:
    return any(w in (t or "") for t in texts for w in blog.CAFE_DESSERT)


def load_by_address(keys: set[str]) -> dict[str, list[dict]]:
    """CSV를 스트리밍하며 '영업 + 인허가 MIN_AGE년 이상 + 주소 키가 DB와 일치'하는 행만 적재."""
    enc = detect_encoding(RESTAURANT_CSV)
    limit_year = TODAY_YEAR - MIN_AGE
    out: dict[str, list[dict]] = defaultdict(list)
    n = kept = 0
    t0 = time.time()
    with RESTAURANT_CSV.open(encoding=enc, newline="") as f:
        r = csv.reader(f)
        h = next(r)
        i_name, i_date, i_state = h.index("사업장명"), h.index("인허가일자"), h.index("영업상태명")
        i_road, i_jibun, i_type = h.index("도로명주소"), h.index("지번주소"), h.index("업태구분명")
        for row in r:
            n += 1
            if len(row) <= i_jibun or not row[i_state].startswith("영업"):
                continue
            m = re.match(r"(\d{4})", row[i_date])
            if not m or int(m.group(1)) > limit_year:
                continue
            road, jibun = row[i_road], row[i_jibun]
            if not any(k in road or k in jibun for k in REGIONS):
                continue
            ks = (addr_keys(road) | addr_keys(jibun)) & keys
            if not ks:
                continue
            kept += 1
            rec = {"year": int(m.group(1)), "name": row[i_name], "type": row[i_type], "state": row[i_state]}
            for k in ks:
                out[k].append(rec)
    print(f"[2차 CSV] {n:,}행 스트리밍 → 주소 일치 {kept:,}건 ({time.time() - t0:.0f}s)")
    return out


def hub_counts(rows: list[dict]) -> Counter:
    return Counter(blog.nearest_hub(r["lat"], r["lng"]) for r in rows)


def second_pass(client, dry: bool, use_blog: bool) -> None:
    rows = fetch_all(
        client,
        {"mode": "nopo"},
        "id,kakao_id,name,address,lat,lng,category,extra,tags,badge,summary,open_year",
    )
    verified_before = [r for r in rows if r["open_year"] is not None]
    todo = [r for r in rows if r["open_year"] is None and "#유저제보" not in (r["tags"] or [])]
    print(f"[2차] 노포 {len(rows)}건 / 확정(open_year) {len(verified_before)} / 미확정 대상 {len(todo)}")

    all_keys: set[str] = set()
    row_keys: dict[str, set[str]] = {}
    for r in todo:
        ks = addr_keys(r["address"] or "")
        row_keys[r["id"]] = ks
        all_keys |= ks
    idx = load_by_address(all_keys)

    OUT.mkdir(exist_ok=True)
    found: list[tuple[dict, int, str]] = []
    skipped = Counter()
    for r in todo:
        cands: list[dict] = []
        for k in row_keys[r["id"]]:
            cands += idx.get(k, [])
        if not cands:
            skipped["주소 일치 없음"] += 1
            continue
        sub = r["tags"][0] if r["tags"] else ""
        ok = [
            c for c in cands
            if names_match(r["name"], c["name"]) and not is_cafe_like(c["name"], c["type"], r["name"], sub)
        ]
        if not ok:
            skipped["상호 불일치/카페·제과"] += 1
            continue
        best = min(ok, key=lambda c: c["year"])  # 같은 주소에 여럿이면 가장 오래된 인허가
        found.append((r, best["year"], best["name"]))
    print(f"[2차] 새로 확정 {len(found)}건 / 제외: {dict(skipped)}")

    # 블로그 교차 검증 (광고 과다 제외 + 요약·태그)
    analysis: dict[str, dict] = {}
    if use_blog and found:
        with ThreadPoolExecutor(max_workers=4) as ex:
            futs = {ex.submit(blog.analyze, r): r for r, _, _ in found}
            for f in as_completed(futs):
                analysis[futs[f]["id"]] = f.result()

    updates: list[tuple[dict, dict, int]] = []
    ad_drop: list[str] = []
    for r, year, _csv_name in found:
        age = TODAY_YEAR - year
        a = analysis.get(r["id"])
        if a and a["rel"] >= 3 and a["ad"] * 2 >= a["rel"]:
            ad_drop.append(r["id"])
            continue
        extra = sorted(set(r["extra"] or []) | ({"veteran"} if age >= 20 else set()))
        updates.append((r, {"badge": f"업력 {age}년", "extra": extra, **build_text(r, a, year, age)}, year))

    # 리포트
    tier = lambda a: "30년+" if a >= 30 else "20~29년" if a >= 20 else "15~19년" if a >= 15 else "10~14년"  # noqa: E731
    print(f"[2차] 갱신 {len(updates)}건 (광고 과다 제외 {len(ad_drop)}건)")
    print("   구간별:", dict(Counter(tier(TODAY_YEAR - y) for _, _, y in updates)))
    for r, u, y in updates[:8]:
        print(f"   ✓ {r['name']} ({r['address']}): 인허가 {y} → {u['badge']} {u['tags']}")
    before_hub, add_hub = hub_counts(verified_before), hub_counts([r for r, _, _ in updates])
    print(f"[결과] 확정 노포 {len(verified_before)} → {len(verified_before) + len(updates)} (+{len(updates)})")
    print("   거점별 (이전 → 이후):")
    for hub in sorted(set(before_hub) | set(add_hub), key=lambda h: -(before_hub[h] + add_hub[h])):
        print(f"     {hub}: {before_hub[hub]} → {before_hub[hub] + add_hub[hub]} (+{add_hub[hub]})")

    if dry:
        print("dry-run: DB 변경 없음")
        return
    if ad_drop:
        client.table("bml_places").delete().in_("id", ad_drop).execute()
    years_map = json.loads(OPEN_YEARS_FILE.read_text(encoding="utf-8")) if OPEN_YEARS_FILE.exists() else {}
    for n, (r, u, y) in enumerate(updates, 1):
        client.table("bml_places").update({**u, "open_year": y}).eq("id", r["id"]).execute()
        years_map[r["id"]] = y
        if n % 100 == 0:
            print(f"  update {n}/{len(updates)}")
    OPEN_YEARS_FILE.write_text(json.dumps(years_map), encoding="utf-8")
    print(f"[2차] DB 반영 완료: 갱신 {len(updates)}건")


# ───────────────────────── [4] 노포 음식 업종 분류 ─────────────────────────
# 검증 노포(open_year 있음)를 CSV의 위생업태명 + 상호 키워드로 분류해 카드에 업종을 표시한다.
# 라벨은 extra 배열의 'food:한식 · 고기·구이' 항목으로 저장한다(스키마 변경 없음). 프론트가 이 접두사를 읽는다.
FOOD_PREFIX = "food:"

KW_CHINESE = ("반점", "중화", "중국", "짜장", "짬뽕", "마라", "양꼬치", "탕수육", "딤섬", "훠궈", "사천", "차이나")
KW_JAPANESE = ("초밥", "스시", "사시미", "오마카세", "이자카야", "돈까스", "돈카츠", "우동", "라멘", "소바", "가츠", "일식")
KW_FISH_RAW = ("횟집", "활어", "물회", "생선회", "횟")
KW_SNACK = ("분식", "떡볶이", "김밥", "라볶이", "어묵", "토스트")
KW_WESTERN = ("파스타", "피자", "스테이크", "함박", "브런치", "버거", "양식", "경양식")
KW_CHICKEN = ("치킨", "통닭", "닭강정", "닭집", "후라이드")
KW_PUB = ("포차", "호프", "주점", "술집", "노가리", "막걸리", "빈대떡", "전집", "맥주", "선술", "포장마차")
KOREAN_SUBS: list[tuple[str, tuple[str, ...]]] = [
    ("국밥·해장", ("국밥", "순대국", "순댓국", "해장", "설렁탕", "곰탕", "육개장", "갈비탕", "추어탕", "감자탕", "뼈해장", "탕반")),
    ("면·칼국수", ("칼국수", "국수", "냉면", "막국수", "수제비", "국시", "밀면", "면옥", "칼제비", "소면")),
    ("고기·구이", ("고기", "구이", "갈비", "삼겹", "곱창", "막창", "대창", "불고기", "숯불", "주물럭", "한우", "돼지", "소고기",
               "오리", "닭갈비", "생고기", "항정", "목살", "차돌", "꼼장어", "정육", "육회", "화로", "불고")),
    ("족발·보쌈", ("족발", "보쌈")),
    ("해물·생선", ("아구", "해물", "낙지", "쭈꾸미", "주꾸미", "꽃게", "조개", "생선", "코다리", "복국", "장어", "해산", "대구", "오징어", "전복")),
    ("백반·찌개", ("백반", "찌개", "한정식", "정식", "비빔밥", "기사식당", "두부", "쌈밥", "보리밥", "밥집", "부대", "청국장", "된장", "제육")),
]
# 위생업태명 → (대분류, 소분류)
UPTE_MAP: dict[str, tuple[str, str | None]] = {
    "한식": ("한식", None),
    "중국식": ("중식", None),
    "일식": ("일식", None),
    "분식": ("분식", None),
    "김밥(도시락)": ("분식", None),
    "경양식": ("양식", None),
    "외국음식전문점(인도,태국등)": ("외국음식", None),
    "식육(숯불구이)": ("한식", "고기·구이"),
    "탕류(보신용)": ("한식", "국밥·해장"),
    "냉면집": ("한식", "면·칼국수"),
    "횟집": ("일식", "횟집"),
    "호프/통닭": ("호프·노포포차", None),
    "감성주점": ("호프·노포포차", None),
    "정종/대포집/소주방": ("호프·노포포차", None),
    "단란주점": ("호프·노포포차", None),
    "유흥주점": ("호프·노포포차", None),
    "통닭(치킨)": ("치킨·통닭", None),
    "복어취급": ("일식", "횟집"),
}


def _has(n: str, kws: tuple[str, ...]) -> bool:
    return any(k in n for k in kws)


def classify_food(name: str, upte: str | None) -> tuple[str, str | None]:
    """(대분류, 소분류). 상호 키워드가 우선이고, 없으면 위생업태명으로 정한다. 모르면 ('음식점', None)."""
    n = re.sub(r"\s+", "", name or "")
    up = (upte or "").strip()
    if up in ("중국식",) or _has(n, KW_CHINESE):
        return ("중식", None)
    if _has(n, ("이자카야",)):
        return ("일식", "이자카야")
    if up == "일식" or _has(n, KW_JAPANESE):
        if _has(n, KW_FISH_RAW):
            return ("일식", "횟집")
        if _has(n, ("초밥", "스시", "오마카세")):
            return ("일식", "초밥")
        if _has(n, ("돈까스", "돈카츠", "우동", "라멘", "소바", "가츠")):
            return ("일식", "돈카츠·우동")
        return ("일식", None)
    if _has(n, KW_FISH_RAW) and up in ("", "한식", "횟집", "기타"):
        return ("일식", "횟집")
    # 국밥류는 '순대'가 들어가도 분식이 아니므로 분식보다 먼저 본다
    if _has(n, KOREAN_SUBS[0][1]):
        return ("한식", "국밥·해장")
    if up in ("분식", "김밥(도시락)") or _has(n, KW_SNACK):
        return ("분식", None)
    if up in ("경양식",) or _has(n, KW_WESTERN):
        return ("양식", None)
    if _has(n, KW_CHICKEN):
        return ("치킨·통닭", None)
    if _has(n, KW_PUB) or up in ("호프/통닭", "감성주점", "단란주점", "유흥주점", "정종/대포집/소주방"):
        return ("호프·노포포차", None)
    for sub, kws in KOREAN_SUBS:
        if _has(n, kws):
            return ("한식", sub)
    if up in UPTE_MAP:
        return UPTE_MAP[up]
    return ("음식점", None)


def food_label(group: str, sub: str | None) -> str | None:
    if group == "음식점":
        return None  # 분류 근거가 없으면 표시하지 않는다
    return f"{group} · {sub}" if sub else group


def food_tag(group: str, sub: str | None) -> str | None:
    if group == "음식점":
        return None
    return f"#{sub or group}"


def food_phrase(group: str, sub: str | None) -> str:
    if sub:
        return f"{group}({sub}) 전문점이에요"
    return {
        "한식": "한식당이에요",
        "중식": "중식당이에요",
        "일식": "일식당이에요",
        "분식": "분식점이에요",
        "양식": "양식당이에요",
        "외국음식": "외국 음식점이에요",
        "치킨·통닭": "치킨·통닭 전문점이에요",
        "호프·노포포차": "호프·노포포차예요",
    }.get(group, "음식점이에요")


TAG_PRIORITY = ["#현지인단골", "#노포감성", "#광고적음"]
DROP_TAG = re.compile(r"^#(업력\d+년|노포|후기확인)$")


def rebuild_tags(old: list[str], tag: str | None, label: str | None) -> list[str]:
    """업종 태그를 맨 앞에 두고, 연차(#업력N년)·#노포 같은 뱃지와 겹치는 태그는 뺀다. 최대 3개."""
    rest = [t for t in old if not DROP_TAG.match(t) and t != tag]
    if label:
        # 업종 라벨과 의미가 겹치는 태그 제거 (예: 라벨 '한식 · 고기·구이' ↔ 카카오 분류 태그 '#육류고기', '#한식')
        tokens = [w for w in re.split(r"[\s·]+", label) if len(w) >= 2]
        rest = [t for t in rest if not any(w in t[1:] for w in tokens) and t[1:] not in label]
    ordered = [t for t in TAG_PRIORITY if t in rest] + [t for t in rest if t not in TAG_PRIORITY and t != "#후기적음"]
    ordered += [t for t in rest if t == "#후기적음"]
    ordered = list(dict.fromkeys(ordered))
    return ([tag] if tag else []) + ordered[: 3 - (1 if tag else 0)]


def load_for_classify(names: set[str], keys: set[str]) -> tuple[dict[str, list[dict]], dict[str, list[dict]]]:
    """CSV 스트리밍: 상호명 또는 주소 키가 DB와 겹치는 영업 행만 적재(업태 포함)."""
    enc = detect_encoding(RESTAURANT_CSV)
    by_name: dict[str, list[dict]] = defaultdict(list)
    by_addr: dict[str, list[dict]] = defaultdict(list)
    limit_year = TODAY_YEAR - MIN_AGE
    with RESTAURANT_CSV.open(encoding=enc, newline="") as f:
        r = csv.reader(f)
        h = next(r)
        i_name, i_date, i_state = h.index("사업장명"), h.index("인허가일자"), h.index("영업상태명")
        i_road, i_jibun = h.index("도로명주소"), h.index("지번주소")
        i_upte, i_alt = h.index("위생업태명"), h.index("업태구분명")
        for row in r:
            if len(row) <= i_jibun or not row[i_state].startswith("영업"):
                continue
            m = re.match(r"(\d{4})", row[i_date])
            if not m or int(m.group(1)) > limit_year:
                continue
            road, jibun = row[i_road], row[i_jibun]
            if not any(k in road or k in jibun for k in REGIONS):
                continue
            key = norm_name(row[i_name])
            ks = (addr_keys(road) | addr_keys(jibun)) & keys
            if key not in names and not ks:
                continue
            rec = {
                "name": row[i_name],
                "year": int(m.group(1)),
                "upte": (row[i_upte] or row[i_alt]).strip(),
                "district": finest_district(road or jibun),
            }
            if key in names:
                by_name[key].append(rec)
            for k in ks:
                by_addr[k].append(rec)
    return by_name, by_addr


def classify_nopo(client, dry: bool) -> None:
    rows = fetch_all(client, {"mode": "nopo"}, "id,name,address,open_year,tags,extra,summary")
    rows = [r for r in rows if r["open_year"] is not None]
    print(f"[분류] 검증 노포 {len(rows)}건 업종 분류 시작")
    names = {norm_name(r["name"]) for r in rows}
    keys: set[str] = set()
    for r in rows:
        keys |= addr_keys(r["address"] or "")
    by_name, by_addr = load_for_classify(names, keys)

    results: list[tuple[dict, str | None, str | None, str]] = []
    stats = Counter()
    labels = Counter()
    upte_seen = Counter()
    unknown: list[str] = []
    for r in rows:
        dist = finest_district(r["address"] or "")
        cands: list[dict] = [c for c in by_name.get(norm_name(r["name"]), []) if c["district"] == dist]
        for k in addr_keys(r["address"] or ""):
            for c in by_addr.get(k, []):
                if c not in cands and names_match(r["name"], c["name"]):
                    cands.append(c)
        same_year = [c for c in cands if c["year"] == r["open_year"]]
        pick = (same_year or cands or [None])[0]
        upte = pick["upte"] if pick else None
        stats["CSV 업태 확인" if pick else "상호 키워드만"] += 1
        upte_seen[upte or "(없음)"] += 1
        group, sub = classify_food(r["name"], upte)
        if (group, sub) in (("한식", None), ("음식점", None)):
            hint = f'{r["name"]} {r["summary"] or ""} {" ".join(r["tags"] or [])}'
            g2, s2 = classify_food(hint, upte)
            if g2 == group or group == "음식점":
                if (g2, s2) != ("음식점", None):
                    group, sub = g2, s2
        label, tag = food_label(group, sub), food_tag(group, sub)
        if label is None and len(unknown) < 12:
            unknown.append(f"{r['name']} [{upte}]")
        labels[label or "(분류 불가)"] += 1
        results.append((r, label, tag, f"{r['open_year']}년 개업 · {food_phrase(group, sub)}."))

    print(f"[분류] {dict(stats)}")
    print("   위생업태명 분포:", dict(upte_seen.most_common(12)))
    print("   라벨 분포:", dict(labels.most_common(25)))
    print("   분류 불가 예:", unknown)
    for r, label, tag, summary in results[:6]:
        print(f"   ✓ {r['name']}: {label} | {rebuild_tags(r['tags'] or [], tag, label)} | {summary}")
    if dry:
        print("dry-run: DB 변경 없음")
        return
    for n, (r, label, tag, summary) in enumerate(results, 1):
        extra = [e for e in (r["extra"] or []) if not e.startswith(FOOD_PREFIX)]
        if label:
            extra.append(f"{FOOD_PREFIX}{label}")
        client.table("bml_places").update(
            {"tags": rebuild_tags(r["tags"] or [], tag, label), "summary": summary, "extra": extra}
        ).eq("id", r["id"]).execute()
        if n % 100 == 0:
            print(f"  update {n}/{len(results)}")
    print(f"[분류] DB 반영 완료: {len(results)}건")


# ───────────────────────── 메인 ─────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-nopo", action="store_true")
    ap.add_argument("--skip-parking", action="store_true")
    ap.add_argument("--no-blog", action="store_true", help="블로그 검색 생략")
    ap.add_argument("--pass2", action="store_true", help="2차: open_year가 빈 노포를 주소 일치+유사 상호명으로 추가 매칭")
    ap.add_argument("--classify", action="store_true", help="검증 노포의 음식 업종 분류 + 태그/요약 정리 (연차 문구 중복 제거)")
    args = ap.parse_args()

    from supabase import create_client

    client = create_client(SUPABASE_URL, SERVICE_KEY)
    if args.classify:
        classify_nopo(client, args.dry_run)
        return 0
    if args.pass2:
        second_pass(client, args.dry_run, not args.no_blog)
        if not args.dry_run:
            classify_nopo(client, False)  # 새로 확정된 노포도 같은 형식(업종 태그·간결 요약)으로 맞춘다
        return 0
    if not args.skip_parking:
        enrich_parking(client, args.dry_run)
    if not args.skip_nopo:
        enrich_nopo(client, args.dry_run, not args.no_blog)
        if not args.dry_run:
            classify_nopo(client, False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
