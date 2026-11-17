"""노포 후보 정제 + 블로그 교차 검증 (`bml_places` 중 mode='nopo').

1차 노이즈 제거: 같은 브랜드가 3곳 이상 → 프랜차이즈로 보고 삭제 / 카페·디저트 업종 삭제
2차 블로그 검증: 카카오 블로그 검색 상위 10건을 분석
    - 관련 글 중 광고성 키워드('소정의 원고료','협찬','제공받아','체험단')가 절반 이상이면 삭제
    - 비광고 글 중 진정성 키워드를 담은 글이 2건 이상이면 '검증 통과' → 요약/태그/뱃지 갱신, #실방문검증전 제거
    - 그 외는 후보 상태 그대로 유지

저작권 정책(CLAUDE.md): 블로그 문장을 그대로 옮기지 않는다. 메뉴·특징 키워드만 집계해 직접 쓴 문장으로 요약한다.
삭제 전 scripts/out/nopo_backup.json 에 백업하고, 삭제한 kakao_id 는 scripts/data/nopo_excluded.json 에 기록해
collect_data.py 가 재수집 시 다시 넣지 않게 한다.

사용법:  python scripts/enrich_nopo.py [--dry-run] [--limit N]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
from collect_data import HUBS  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local")

KAKAO_KEY = os.environ.get("KAKAO_REST_API_KEY", "")
SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
BLOG_URL = "https://dapi.kakao.com/v2/search/blog"
EXCLUDED_FILE = ROOT / "scripts" / "data" / "nopo_excluded.json"

AD_WORDS = ["소정의 원고료", "협찬", "제공받아", "체험단"]
AUTH_WORDS = ["노포", "단골", "오래된", "세월", "전통", "20년", "30년", "40년", "할머니"]
OLD_WORDS = {"노포", "오래된", "세월", "전통", "20년", "30년", "40년"}

CAFE_DESSERT = [
    "카페", "커피", "베이커리", "제과", "빵", "디저트", "아이스크림", "도넛", "케이크", "와플",
    "빙수", "마카롱", "샌드위치", "토스트", "떡카페", "찻집", "브런치", "스무디", "젤라또",
]
MENUS = [
    "순대국", "국밥", "돼지국밥", "설렁탕", "곰탕", "갈비탕", "해장국", "감자탕", "추어탕", "칼국수",
    "수제비", "냉면", "막국수", "비빔밥", "백반", "김치찌개", "된장찌개", "순두부", "곱창", "막창",
    "족발", "보쌈", "삼겹살", "갈비", "불고기", "닭갈비", "닭볶이", "찜닭", "육회", "생선구이", "횟집",
    "만두", "전집", "파전", "막걸리", "떡볶이", "순대", "튀김", "짜장면", "짬뽕", "탕수육", "돈까스",
    "우동", "라멘", "소바", "초밥", "양꼬치", "오징어", "낙지", "아구찜", "수육", "육개장", "비지찌개",
]


# ───────────────────────── 유틸 ─────────────────────────
def strip_tags(s: str) -> str:
    return re.sub(r"<[^>]+>|&[a-z]+;", " ", s)


def brand_of(name: str) -> str:
    n = re.sub(r"\(.*?\)", "", name).strip()
    parts = n.split()
    branch = r"(본점|[가-힣0-9]{1,6}점)$"
    if len(parts) > 1 and re.search(branch, parts[-1]):
        n = " ".join(parts[:-1])
    elif len(parts) == 1:
        stripped = re.sub(branch, "", n)
        n = stripped if len(stripped) >= 2 else n
    return n.strip()


def nearest_hub(lat: float, lng: float) -> str:
    return min(HUBS, key=lambda h: (HUBS[h][0] - lat) ** 2 + (HUBS[h][1] - lng) ** 2)


def fetch_all(client) -> list[dict]:
    rows: list[dict] = []
    off = 0
    while True:
        r = (
            client.table("bml_places")
            .select("id,kakao_id,name,address,lat,lng,category,extra,tags,badge,summary")
            .eq("mode", "nopo")
            .range(off, off + 999)
            .execute()
            .data
        )
        rows += r
        if len(r) < 1000:
            return rows
        off += 1000


def blog_search(query: str) -> list[dict]:
    for attempt in range(3):
        r = requests.get(
            BLOG_URL,
            headers={"Authorization": f"KakaoAK {KAKAO_KEY}"},
            params={"query": query, "size": 10, "sort": "accuracy"},
            timeout=10,
        )
        if r.status_code == 429:
            time.sleep(1 + attempt)
            continue
        if r.status_code != 200:
            return []
        return r.json().get("documents", [])
    return []


# ───────────────────────── 블로그 분석 ─────────────────────────
def analyze(row: dict) -> dict:
    hub = nearest_hub(row["lat"], row["lng"])
    docs = blog_search(f"{hub} {row['name']}")
    core = re.sub(r"\s+", "", brand_of(row["name"]))[:6]
    rel = []
    for d in docs:
        text = strip_tags(d["title"] + " " + d["contents"])
        if core and core in re.sub(r"\s+", "", text):
            # 상호명 자체에 든 단어('전통', '할머니', 메뉴명)가 특징으로 집계되지 않게 상호명을 제거
            for nm in {row["name"], brand_of(row["name"])}:
                pat = r"\s*".join(re.escape(ch) for ch in re.sub(r"\s+", "", nm))
                text = re.sub(pat, " ", text)
            rel.append(text)
    ad = [t for t in rel if any(w in t for w in AD_WORDS)]
    clean = [t for t in rel if t not in ad]
    authentic = [t for t in clean if any(w in t for w in AUTH_WORDS)]
    return {"hub": hub, "rel": len(rel), "ad": len(ad), "clean": clean, "authentic": authentic}


def build_enrichment(row: dict, a: dict) -> dict:
    texts = a["authentic"]
    joined = " ".join(texts)
    menu_count = Counter()
    for t in a["clean"]:
        for m in MENUS:
            if m in t:
                menu_count[m] += 1
    menus = [m for m, _ in menu_count.most_common(2)]

    hit = {w for w in AUTH_WORDS if w in joined}
    feats: list[tuple[str, str]] = []  # (태그, 문구)
    if "단골" in hit:
        feats.append(("#현지인단골", "단골"))
    if hit & OLD_WORDS:
        feats.append(("#노포감성", "오래된 가게"))
    if "할머니" in hit:
        feats.append(("#할머니손맛", "할머니 손맛"))

    tags: list[str] = []
    if menus:
        tags.append(f"#{menus[0]}")
    tags += [t for t, _ in feats]
    if a["ad"] == 0:
        tags.append("#광고적음")
    if len(menus) > 1:
        tags.append(f"#{menus[1]}")
    tags = list(dict.fromkeys(tags))[:3]
    while len(tags) < 3:
        tags.append("#후기확인")

    feat_txt = feats[0][1] if feats else "오래된 가게"
    if menus:
        summary = f"{'·'.join(menus)} 후기가 있고 {feat_txt} 언급이 있어요."
    else:
        summary = f"블로그 후기에 {feat_txt} 언급이 있는 동네 맛집이에요."

    badge = row["badge"] if row["badge"].startswith("업력") else "후기 검증"
    return {"summary": summary, "tags": tags, "badge": badge}


# ───────────────────────── 메인 ─────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="블로그 검증 대상 최대 건수(테스트용)")
    args = ap.parse_args()

    from supabase import create_client

    client = create_client(SUPABASE_URL, SERVICE_KEY)
    rows = fetch_all(client)
    print(f"노포 {len(rows)}건 로드")

    out = ROOT / "scripts" / "out"
    out.mkdir(exist_ok=True)
    (out / "nopo_backup.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")

    # ── 1차: 프랜차이즈·카페/디저트 제거 ──
    by_brand: dict[str, set[str]] = defaultdict(set)
    for r in rows:
        by_brand[brand_of(r["name"])].add(r["address"] or r["id"])
    franchise = {b for b, addrs in by_brand.items() if len(b) >= 2 and len(addrs) >= 3}

    drop_ids: dict[str, str] = {}  # id -> 사유
    keep: list[dict] = []
    for r in rows:
        sub = r["tags"][0] if r["tags"] else ""
        if any(k in sub or k in r["name"] for k in CAFE_DESSERT):
            drop_ids[r["id"]] = "cafe"
        elif brand_of(r["name"]) in franchise:
            drop_ids[r["id"]] = "franchise"
        else:
            keep.append(r)
    c = Counter(drop_ids.values())
    print(f"[1차] 삭제 대상 {len(drop_ids)}건 (프랜차이즈 {c['franchise']}, 카페·디저트 {c['cafe']}) → 남음 {len(keep)}")
    print(f"      프랜차이즈 브랜드 {len(franchise)}개 예: {', '.join(list(franchise)[:8])}")

    # ── 2차: 블로그 교차 검증 ──
    targets = keep[: args.limit] if args.limit else keep
    results: dict[str, dict] = {}
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(analyze, r): r for r in targets}
        for i, f in enumerate(as_completed(futs), 1):
            results[futs[f]["id"]] = f.result()
            if i % 100 == 0:
                print(f"  blog {i}/{len(targets)} ({time.time() - t0:.0f}s)")

    verified: list[tuple[dict, dict]] = []
    stats = Counter()
    for r in targets:
        a = results[r["id"]]
        if a["rel"] >= 3 and a["ad"] * 2 >= a["rel"]:
            drop_ids[r["id"]] = "ad"
            stats["ad"] += 1
        elif a["rel"] == 0:
            stats["no_blog"] += 1
        elif len(a["authentic"]) >= 2:
            verified.append((r, build_enrichment(r, a)))
            stats["verified"] += 1
        else:
            stats["unverified"] += 1
    print(f"[2차] 광고 과다 삭제 {stats['ad']}, 검증 통과 {stats['verified']}, "
          f"후기 부족 유지 {stats['unverified']}, 관련 글 없음 유지 {stats['no_blog']}")
    for r, e in verified[:8]:
        print(f"   ✓ {r['name']}: {e['tags']} | {e['summary']}")

    if args.dry_run:
        print("dry-run: DB 변경 없음")
        return 0

    # ── DB 반영 ──
    ids = list(drop_ids)
    for i in range(0, len(ids), 100):
        client.table("bml_places").delete().in_("id", ids[i : i + 100]).execute()
    excluded = {r["kakao_id"] for r in rows if r["id"] in drop_ids and r["kakao_id"]}
    EXCLUDED_FILE.parent.mkdir(exist_ok=True)
    old = set(json.loads(EXCLUDED_FILE.read_text(encoding="utf-8"))) if EXCLUDED_FILE.exists() else set()
    EXCLUDED_FILE.write_text(json.dumps(sorted(old | excluded), ensure_ascii=False), encoding="utf-8")
    print(f"삭제 {len(ids)}건, 제외 목록 {len(old | excluded)}건 기록")

    for n, (r, e) in enumerate(verified, 1):
        client.table("bml_places").update(e).eq("id", r["id"]).execute()
        if n % 100 == 0:
            print(f"  update {n}/{len(verified)}")
    print(f"갱신 {len(verified)}건 완료")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
