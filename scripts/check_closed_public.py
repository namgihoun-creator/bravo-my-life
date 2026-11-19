"""
공공데이터(지방행정인허가 일반음식점 CSV) 기반 노포 폐업 감지 — 로컬 전용(CSV 670MB는 gitignore라 Actions 불가).

- 대상: 화면에 노출되는 검증 노포(mode='nopo', is_active, open_year 있음).
- 매칭: scripts/enrich_data.py 의 함수(norm_name·finest_district·road_key·addr_keys·names_match)를 그대로 재사용한다.
  1차 = 상호 정규화 일치 + 같은 구 + 도로명번호(없으면 구 안 유일 후보), 2차 = 주소 키 + 핵심 상호 유사.
  기존 로더와 달리 영업/폐업·인허가 연도 제한 없이 전체 행을 읽고 영업상태·폐업일자·관리번호를 함께 담는다.
- 판정(2단계):
  조건 1) 매칭 후보 중 '영업' 상태가 하나라도 있으면 통과(양도양수 방어).
  조건 2) 후보가 모두 '폐업'이고 (폐업일 연도 >= DB 업력 연도)일 때만 폐업 의심. 미래 날짜 등 비정상 폐업일은 무시한다.
  조치 A) |CSV 인허가 연도 - DB 업력| <= 1 이면 is_active=false (소프트 삭제, 행은 절대 DELETE 하지 않는다).
  조치 B) 연도 차이가 2년 이상이면 보수적으로 reported_issue='closed'(경고 표시)만 건다. 이미 제보·플래그된 행은 건드리지 않는다.
- 기본은 dry-run(DB 쓰기 없음). --apply 가 있을 때만 갱신한다. 의심 비율이 --max-pct(기본 3%)를 넘으면 --apply 도 거부한다.

사용법:
    python scripts/check_closed_public.py                 # dry-run, 리포트: scripts/out/closed_public_report.json
    python scripts/check_closed_public.py --apply         # 조치 A/B 반영
    python scripts/check_closed_public.py --selftest      # 판정 규칙 자체 테스트(CSV·DB 불필요)
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import enrich_data as ed  # noqa: E402  (기존 정규화·매칭 함수와 환경변수 재사용, 이 파일은 수정하지 않는다)

OUT = Path(__file__).resolve().parent / "out" / "closed_public_report.json"
YEAR_TOLERANCE = 1  # 조치 A: |CSV 인허가 연도 - DB 업력| <= 1 (인허가일과 개업 연도가 한 해 어긋나는 경우 허용)


# ───────────────────────── 파서 ─────────────────────────
def parse_closed_date(raw: str, today: date) -> date | None:
    """'YYYY-MM-DD…' → date. 비어 있거나 형식 오류, 미래 날짜는 None(무시)."""
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", (raw or "").strip())
    if not m:
        return None
    try:
        d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None
    return None if d > today else d


def load_all_rows(csv_path: Path, names: set[str], keys: set[str], today: date) -> tuple[dict, dict, str]:
    """CSV 전체(영업/폐업·연도 무관)를 스트리밍해, DB 노포의 상호 또는 주소 키와 겹치는 행만 상태와 함께 적재한다."""
    enc = ed.detect_encoding(csv_path)
    by_name: dict[str, list[dict]] = defaultdict(list)
    by_addr: dict[str, list[dict]] = defaultdict(list)
    n = kept = 0
    latest_update = ""
    t0 = time.time()
    with csv_path.open(encoding=enc, newline="") as f:
        r = csv.reader(f)
        h = next(r)
        col = {k: h.index(k) for k in ("사업장명", "인허가일자", "영업상태명", "폐업일자", "관리번호", "도로명주소", "지번주소")}
        i_upd = h.index("데이터갱신시점") if "데이터갱신시점" in h else None
        i_last = max(col.values())
        for row in r:
            n += 1
            if len(row) <= i_last:
                continue
            if i_upd is not None and len(row) > i_upd and row[i_upd] > latest_update:
                latest_update = row[i_upd]
            road, jibun = row[col["도로명주소"]], row[col["지번주소"]]
            if not any(k in road or k in jibun for k in ed.REGIONS):
                continue
            m = re.match(r"(\d{4})", row[col["인허가일자"]])
            if not m:
                continue
            key = ed.norm_name(row[col["사업장명"]])
            ks = (ed.addr_keys(road) | ed.addr_keys(jibun)) & keys
            if key not in names and not ks:
                continue
            kept += 1
            rec = {
                "name": row[col["사업장명"]],
                "year": int(m.group(1)),
                "road": road,
                "jibun": jibun,
                "district": ed.finest_district(road or jibun),
                "alive": row[col["영업상태명"]].startswith("영업"),
                "closed_at": parse_closed_date(row[col["폐업일자"]], today),
                "mgt": row[col["관리번호"]],
            }
            if key in names:
                by_name[key].append(rec)
            for k in ks:
                by_addr[k].append(rec)
            if n % 1_000_000 == 0:
                print(f"  {n:,}행 처리 ({time.time() - t0:.0f}s), 후보 {kept:,}")
    print(f"[CSV] {csv_path.name} {n:,}행 → 상호·주소가 겹치는 후보 {kept:,}건 ({time.time() - t0:.0f}s), 데이터 갱신 {latest_update[:10] or '?'}")
    return by_name, by_addr, latest_update[:10]


# ───────────────────────── 매칭 + 판정 ─────────────────────────
def match_candidates(row: dict, by_name: dict, by_addr: dict) -> tuple[list[dict], str]:
    """enrich_data 의 1차(match_open_year)·2차(second_pass) 규칙과 같되, 상태와 무관하게 후보를 모은다."""
    same = [
        c for c in by_name.get(ed.norm_name(row["name"]), [])
        if c["district"] and c["district"] == ed.finest_district(row["address"] or "")
    ]
    rk = ed.road_key(row["address"] or "")
    cand = [c for c in same if rk and ed.road_key(c["road"]) == rk]
    if not cand and len(same) == 1:
        cand = same
    if cand:
        return cand, "1차"
    pool: list[dict] = []
    for k in ed.addr_keys(row["address"] or ""):
        pool += by_addr.get(k, [])
    return [c for c in pool if ed.names_match(row["name"], c["name"])], "2차"


def decide(open_year: int, cands: list[dict]) -> dict:
    """
    status: no-match | alive | past-closure | bad-date | suspect-A | suspect-B
    (suspect-* 만 조치 대상)
    """
    if not cands:
        return {"status": "no-match"}
    if any(c["alive"] for c in cands):
        return {"status": "alive"}  # 조건 1: 양도양수 방어
    dated = [c for c in cands if c["closed_at"]]
    if not dated:
        return {"status": "bad-date"}  # 폐업 행뿐이지만 폐업일이 비었거나 비정상 → 판단 보류
    latest = max(dated, key=lambda c: c["closed_at"])
    if latest["closed_at"].year < open_year:
        return {"status": "past-closure", "csv": latest}  # 현재 업력보다 앞선 옛 폐업(다른 사업자) → 무시
    return {"status": "suspect-A" if abs(latest["year"] - open_year) <= YEAR_TOLERANCE else "suspect-B", "csv": latest}


def selftest() -> None:
    d = date.today()

    def rec(year, alive, closed):
        return {"name": "x", "year": year, "alive": alive, "closed_at": closed, "mgt": "m"}

    assert decide(2000, [])["status"] == "no-match"
    assert decide(2000, [rec(1990, False, date(2020, 1, 1)), rec(2010, True, None)])["status"] == "alive"  # 영업 하나라도 있으면 통과
    assert decide(1994, [rec(1994, False, date(2025, 10, 23))])["status"] == "suspect-A"  # 연도 일치 → 숨김
    assert decide(1994, [rec(1993, False, date(2025, 10, 23))])["status"] == "suspect-A"  # 팔덕식당: 1년 차이 → 숨김
    assert decide(1994, [rec(1995, False, date(2025, 10, 23))])["status"] == "suspect-A"  # 반대 방향 1년도 허용
    assert decide(1994, [rec(1996, False, date(2025, 10, 23))])["status"] == "suspect-B"  # 2년 이상 차이 → 경고만
    assert decide(2015, [rec(1999, False, date(2003, 6, 25))])["status"] == "past-closure"  # 별난집: 옛 폐업은 무시
    assert decide(2015, [rec(2017, False, date(2023, 8, 21))])["status"] == "suspect-B"  # 미정이네코다리찜
    assert decide(2015, [rec(2015, False, None)])["status"] == "bad-date"
    assert parse_closed_date("2999-01-01", d) is None  # 미래 날짜 무시
    assert parse_closed_date("", d) is None and parse_closed_date("2020-13-45", d) is None
    assert parse_closed_date("2023-08-21 00:00:00", d) == date(2023, 8, 21)
    print("selftest OK")


# ───────────────────────── 실행 ─────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="DB 갱신(조치 A/B). 기본은 dry-run")
    ap.add_argument("--csv", type=Path, default=ed.RESTAURANT_CSV)
    ap.add_argument("--max-pct", type=float, default=3.0, help="폐업 의심 비율 상한(%%). 넘으면 --apply 거부")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        selftest()
        return
    if not args.csv.exists():
        sys.exit(f"CSV 가 없습니다: {args.csv}")
    if not (ed.blog.SUPABASE_URL and ed.blog.SERVICE_KEY):
        sys.exit("환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (.env.local)")
    from supabase import create_client

    client = create_client(ed.blog.SUPABASE_URL, ed.blog.SERVICE_KEY)
    today = date.today()

    rows = ed.fetch_all(client, {"mode": "nopo"}, "id,name,address,open_year,is_active,reported_issue,source")
    rows = [r for r in rows if r.get("is_active") and r["open_year"] is not None]
    print(f"[대상] 검증 노포 {len(rows)}곳 ({'APPLY' if args.apply else 'dry-run'})")
    names = {ed.norm_name(r["name"]) for r in rows}
    keys: set[str] = set()
    for r in rows:
        keys |= ed.addr_keys(r["address"] or "")
    by_name, by_addr, updated = load_all_rows(args.csv, names, keys, today)

    tally: Counter = Counter()
    act_a: list[dict] = []
    act_b: list[dict] = []
    for r in rows:
        cands, how = match_candidates(r, by_name, by_addr)
        d = decide(r["open_year"], cands)
        tally[d["status"] + (f"({how})" if d["status"] == "alive" else "")] += 1
        if d["status"] in ("suspect-A", "suspect-B"):
            c = d["csv"]
            item = {
                "id": r["id"], "name": r["name"], "address": r["address"], "db_open_year": r["open_year"],
                "csv_name": c["name"], "csv_license_year": c["year"], "csv_closed_at": c["closed_at"].isoformat(),
                "csv_mgt_no": c["mgt"], "already_flagged": r.get("reported_issue"),
            }
            if d["status"] == "suspect-A":
                item["reason"] = f"인허가 {c['year']}년 ≈ DB 업력 {r['open_year']}년(±{YEAR_TOLERANCE}), {c['closed_at']} 폐업 → 숨김(is_active=false)"
                act_a.append(item)
            else:
                item["reason"] = f"인허가 {c['year']}년과 DB 업력 {r['open_year']}년 차이 > {YEAR_TOLERANCE}, {c['closed_at']} 폐업 → 경고만(reported_issue='closed')"
                act_b.append(item)

    total = len(rows)
    suspects = len(act_a) + len(act_b)
    matched = total - tally["no-match"]
    print("\n── 폐업 감지 리포트 ──")
    print(f"검사 {total}곳 | CSV 일치 {matched}곳 ({100 * matched / max(1, total):.1f}%) / 불일치 {tally['no-match']}곳 | CSV 기준일 {updated}")
    print(f"  영업 확인 {tally['alive(1차)'] + tally['alive(2차)']}곳 (1차 {tally['alive(1차)']} + 2차 {tally['alive(2차)']})")
    print(f"  옛 폐업 무시 {tally['past-closure']}곳 (폐업일 연도 < DB 업력) | 폐업일 비정상 보류 {tally['bad-date']}곳")
    print(f"  폐업 의심 {suspects}곳 ({100 * suspects / max(1, total):.2f}%)")
    for title, lst in (("조치 A — 숨김 is_active=false", act_a), ("조치 B — 경고 reported_issue='closed'", act_b)):
        print(f"\n[{title}] {len(lst)}곳")
        for x in lst:
            flag = f" (이미 {x['already_flagged']} 표시됨)" if x["already_flagged"] else ""
            print(f"  - {x['name']} | {x['address']}\n      {x['reason']} · CSV 상호 '{x['csv_name']}' · 관리번호 {x['csv_mgt_no']}{flag}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"checked": total, "tally": dict(tally), "csv_updated": updated, "action_a": act_a, "action_b": act_b},
                              ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n리포트: {OUT}")

    if not args.apply:
        print("--apply 가 없어 DB 에 쓰지 않았습니다.")
        return
    if total and 100 * suspects / total > args.max_pct:
        sys.exit(f"의심 비율이 상한 {args.max_pct}%를 넘어 반영을 거부합니다(CSV·매칭 이상 가능성). 원인 확인 후 --max-pct 로 조정하세요.")
    for x in act_a:
        client.table("bml_places").update({"is_active": False}).eq("id", x["id"]).execute()
    for x in act_b:
        # 이미 제보·플래그된 행은 그대로 둔다
        client.table("bml_places").update({"reported_issue": "closed"}).eq("id", x["id"]).is_("reported_issue", "null").execute()
    print(f"반영 완료: 조치 A {len(act_a)}곳, 조치 B {len(act_b)}곳")


if __name__ == "__main__":
    main()
