"""공공데이터로 노포 업력 검증 + 공영주차장 요금·운영시간 매칭.

입력(data/raw/):
    식품_일반음식점.csv            (전국 일반음식점 인허가, 약 700MB → csv 모듈로 스트리밍)
    전국주차장정보표준데이터.csv     (전국 주차장 정보)

[1] 노포 (mode='nopo')
    - CSV에서 서울·경기 + 영업 중인 행만, 그것도 DB 노포 상호명과 일치하는 행만 메모리에 적재
    - 상호명 + 구/도로명주소로 매칭해 인허가일자 → 업력 계산
    - 같은 상호가 3개 이상 구에 있으면 프랜차이즈로 삭제 / 업력 15년 미만이면 삭제
    - 업력 15년 이상은 '진짜 노포'로 확정(open_year, 뱃지 '업력 N년', 20년 이상은 veteran 필터)
    - 확정 노포는 카카오 블로그 검색으로 광고 비율을 보고(절반 이상이면 삭제) 요약·태그 갱신
      (CLAUDE.md 저작권 규칙: 블로그 문장은 옮기지 않고 키워드만 집계해 직접 쓴 문장으로 요약)
    - CSV에서 못 찾은 후보는 그대로 둔다 (검증 불가 ≠ 가짜)

[2] 공영주차장 (category='parking')
    - 서울·경기 '공영' 주차장 CSV와 좌표(+이름 유사도)로 매칭해 요금·운영시간 태그/요약 갱신

사용법:  python scripts/enrich_data.py [--dry-run] [--skip-nopo] [--skip-parking] [--no-blog]
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

TODAY_YEAR = date.today().year
MIN_AGE = 15


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
            if not ("서울특별시" in road or "경기도" in road or "서울특별시" in jibun or "경기도" in jibun):
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
    print(f"[CSV] 총 {n:,}행 → DB 상호와 일치하는 서울·경기 영업 행 {kept:,}건 ({time.time() - t0:.0f}s)")
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
    print(f"[노포] 프랜차이즈 삭제 {c['franchise']} / 15년 미만 삭제 {c['young']} / "
          f"업력 15년+ 확정 {len(confirmed)} / CSV 미매칭 유지 {unmatched}")

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
            if not (addr.strip().startswith(("서울", "경기")) or "서울특별시" in addr or "경기도" in addr):
                continue
            if (row["주차장구분"] or "").strip() != "공영":
                continue
            try:
                row["lat"], row["lng"] = float(row["위도"]), float(row["경도"])
            except ValueError:
                continue
            out.append(row)
    print(f"[주차장] CSV 서울·경기 공영 {len(out):,}건 (인코딩 {enc})")
    return out


def dist_m(a_lat, a_lng, b_lat, b_lng) -> float:
    dy = (a_lat - b_lat) * 111_000
    dx = (a_lng - b_lng) * 111_000 * math.cos(math.radians(a_lat))
    return math.hypot(dx, dy)


def pk_norm(s: str) -> str:
    return re.sub(r"(공영|주차장|노외|노상|제?\d+호?|\s)", "", s)


TYPE_TAG = {"노외": "#노외주차장", "노상": "#노상주차", "건축물부설": "#건물부설"}
SPECIAL = {"#기계식주의", "#지하주차장", "#노상주차"}


def enrich_parking(client, dry: bool) -> None:
    lots = load_parking()
    grid: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for c in lots:
        grid[(int(c["lat"] * 200), int(c["lng"] * 200))].append(c)

    rows = fetch_all(client, {"category": "parking"}, "id,name,lat,lng,tags,summary,badge")
    print(f"[주차장] DB {len(rows)}건")
    updates: list[tuple[str, dict]] = []
    for r in rows:
        gx, gy = int(r["lat"] * 200), int(r["lng"] * 200)
        near = [
            (dist_m(r["lat"], r["lng"], c["lat"], c["lng"]), c)
            for dx in (-1, 0, 1)
            for dy in (-1, 0, 1)
            for c in grid.get((gx + dx, gy + dy), [])
        ]
        near = [(d, c) for d, c in near if d <= 200]
        if not near:
            continue
        scored = sorted(
            ((SequenceMatcher(None, pk_norm(r["name"]), pk_norm(c["주차장명"])).ratio(), d, c) for d, c in near),
            key=lambda x: (-x[0], x[1]),
        )
        ratio, d, c = scored[0]
        if not (ratio >= 0.55 or (d <= 60 and len(near) == 1)):
            continue

        spec = parking_spec(c)
        cur_special = next((t for t in r["tags"] if t in SPECIAL), None)
        third = spec["third"] or cur_special or TYPE_TAG.get(spec["type"], "#공영주차장")
        tags = list(dict.fromkeys([spec["fee_tag"], spec["hours_tag"], third]))
        while len(tags) < 3:
            tags.append("#공영주차장")
        updates.append((r["id"], {"tags": tags[:3], "summary": spec["summary"]}))

    print(f"[주차장] CSV와 매칭·갱신 {len(updates)}건 / 미매칭 {len(rows) - len(updates)}건(민영 등)")
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


# ───────────────────────── 메인 ─────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-nopo", action="store_true")
    ap.add_argument("--skip-parking", action="store_true")
    ap.add_argument("--no-blog", action="store_true", help="블로그 검색 생략")
    args = ap.parse_args()

    from supabase import create_client

    client = create_client(SUPABASE_URL, SERVICE_KEY)
    if not args.skip_parking:
        enrich_parking(client, args.dry_run)
    if not args.skip_nopo:
        enrich_nopo(client, args.dry_run, not args.no_blog)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
