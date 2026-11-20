"""서울·경기 거점 반경 2km 데이터 수집 → Supabase `bml_places` upsert.

사용법:
    python scripts/collect_data.py              # 수집 + upsert
    python scripts/collect_data.py --dry-run    # DB에 쓰지 않고 scripts/out/places.json 으로 저장
    python scripts/collect_data.py --hubs 부천역 강남역

필요: pip install requests supabase python-dotenv
환경변수(.env.local): KAKAO_REST_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local")

KAKAO_KEY = os.environ.get("KAKAO_REST_API_KEY", "")
SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

KAKAO_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
RADIUS_M = 2000
MAX_PAGES = 3  # 카카오 키워드 검색은 최대 45건(15건 x 3페이지)

EXCLUDED_FILE = ROOT / "scripts" / "data" / "nopo_excluded.json"
# enrich_nopo.py 가 프랜차이즈·광고 과다 등으로 삭제한 노포 — 재수집 시 다시 넣지 않는다
EXCLUDED_IDS: set[str] = (
    set(json.loads(EXCLUDED_FILE.read_text(encoding="utf-8"))) if EXCLUDED_FILE.exists() else set()
)

HUBS = {
    "홍대입구역": (37.5572, 126.9245),
    "성수역": (37.5446, 127.0560),
    "신림역": (37.4842, 126.9293),
    "노량진역": (37.5133, 126.9425),
    "건대입구역": (37.5404, 127.0692),
    "강남역": (37.4979, 127.0276),
    "잠실역": (37.5133, 127.1001),
    "부천역": (37.4844, 126.7830),
    "수원역": (37.2660, 127.0000),
    "판교역": (37.3948, 127.1112),
    "안양역": (37.4017, 126.9227),
    "정발산역": (37.6595, 126.7733),
    "송내역": (37.4875, 126.7534),
    "영등포역": (37.5156, 126.9076),
    "사당역": (37.4765, 126.9816),
    "신촌역": (37.5551, 126.9368),
    "서현역": (37.3846, 127.1231),
    "부평역": (37.4896, 126.7243),
    "을지로3가역": (37.5663, 126.991),
    "종로3가역": (37.5704, 126.9922),
    "공덕역": (37.5445, 126.9515),
    "문래역": (37.518, 126.8948),
    "삼각지역": (37.5344, 126.9729),
    "왕십리역": (37.5613, 127.0371),
    "천호역": (37.5385, 127.1239),
    "연신내역": (37.6192, 126.9211),
    "노원역": (37.6563, 127.0634),
    "구리역": (37.6033, 127.1434),
    "의정부역": (37.7384, 127.046),
    "화정역": (37.6346, 126.8327),
    "중앙역": (37.316, 126.8388),
    "범계역": (37.3898, 126.9508),
    "모란역": (37.434, 127.13),
    "수지구청역": (37.3225, 127.0947),
    "철산역": (37.4762, 126.8682),
    "정왕역": (37.3517, 126.7434),
    # 생활권 보강(수원 전역·근교·서울 남부·부천) — 좌표는 카카오 장소 검색으로 확인
    "행궁동": (37.2819, 127.0148),
    "인계동": (37.2619, 127.0309),
    "영통역": (37.2515, 127.0713),
    "광교중앙역": (37.2884, 127.0517),
    "망포역": (37.2457, 127.0573),
    "화서역": (37.2840, 126.9896),
    "장안구청": (37.3039, 127.0103),
    "호매실": (37.2664, 126.9579),
    "동탄역": (37.1999, 127.0957),
    "병점역": (37.2068, 127.0332),
    "죽전역": (37.3244, 127.1075),
    "기흥역": (37.2755, 127.1170),
    "의왕역": (37.3203, 126.9480),
    "샤로수길(서울대입구역)":(37.4813, 126.9527),
    "낙성대역": (37.4771, 126.9635),
    "이수역": (37.4853, 126.9817),
    "중동역": (37.4867, 126.7645),
    "상동역": (37.5058, 126.7532),
}

# ───────────── [긴급 생존 모드] 검색어 → 카테고리 ─────────────
SURVIVAL_QUERIES = [
    # 코인세탁
    ("24시 코인세탁소", "laundry"),
    ("코인빨래방", "laundry"),
    ("크린토피아 코인워시", "laundry"),
    ("워시엔조이", "laundry"),
    ("셀프빨래방", "laundry"),
    # 무인프린트
    ("무인프린트", "print"),
    ("무인 프린트", "print"),
    ("셀프 프린트", "print"),
    ("프린트카페", "print"),
    ("무인복사", "print"),
    ("24시 인쇄", "print"),
    # 심야약국
    ("심야약국", "pharmacy"),
    ("24시 약국", "pharmacy"),
    ("공공심야약국", "pharmacy"),
    ("365약국", "pharmacy"),
    ("연중무휴 약국", "pharmacy"),
    # 공영주차장
    ("공영주차장", "parking"),
    # 개방화장실
    ("개방화장실", "toilet"),
    ("공중화장실", "toilet"),
    ("공공화장실", "toilet"),
    ("지하철역 화장실", "toilet"),
    ("공원 화장실", "toilet"),
    ("개방화장실 무료", "toilet"),
    # 보조배터리
    ("보조배터리 대여", "battery"),
    ("보조배터리", "battery"),
    ("충전돼지", "battery"),
    ("에브리포터블", "battery"),
    ("아잉 보조배터리", "battery"),
]

# 카테고리별 기본 스펙 태그 (카카오 데이터로 확인 불가한 항목은 '확인 필요' 성격의 중립 태그)
DEFAULT_TAGS = {
    "laundry": ["#코인세탁", "#셀프빨래방", "#결제수단확인"],
    "print": ["#무인프린트", "#셀프출력", "#용지재고확인"],
    "pharmacy": ["#약국", "#심야영업확인", "#전화문의권장"],
    "parking": ["#공영주차장", "#주차방식확인", "#요금현장확인"],
    "battery": ["#보조배터리", "#대여", "#재고현장확인"],
    "toilet": ["#개방화장실", "#이용시간확인", "#청결현장확인"],
}

# ───────────── [찐노포 탐색 모드] ─────────────
NOPO_QUERIES = ["노포", "본점", "기사식당", "전통"]

SUMMARY = {
    "laundry": "근처 코인세탁소 후보예요. 24시 운영 여부와 결제 수단은 방문 전 확인해 주세요.",
    "print": "무인프린트 후보예요. 용지 재고와 출력 가능 사이즈는 현장 후기를 참고하세요.",
    "pharmacy": "약국 후보예요. 심야 영업 시간은 전화나 지도 앱에서 한 번 더 확인하세요.",
    "parking": "공영주차장 후보예요. 요금과 주차 방식(자주식/기계식)은 현장 안내를 확인하세요.",
    "battery": "보조배터리 대여 후보예요. 대여 재고와 반납 방식은 현장에서 확인하세요.",
    "toilet": "개방·공중화장실 후보예요. 이용 가능 시간은 현장 안내를 확인하세요.",
}


def kakao_search(query: str, lat: float, lng: float, group: str | None = None, radius: int | None = None) -> list[dict]:
    out: list[dict] = []
    for page in range(1, MAX_PAGES + 1):
        params = {"query": query, "x": lng, "y": lat, "radius": radius or RADIUS_M, "size": 15, "page": page, "sort": "distance"}
        if group:
            params["category_group_code"] = group
        for attempt in range(3):
            r = requests.get(KAKAO_URL, headers={"Authorization": f"KakaoAK {KAKAO_KEY}"}, params=params, timeout=10)
            if r.status_code == 429:
                time.sleep(1 + attempt)
                continue
            break
        if r.status_code != 200:
            print(f"  ! Kakao {r.status_code}: {r.text[:120]}", file=sys.stderr)
            break
        data = r.json()
        out.extend(data.get("documents", []))
        if data.get("meta", {}).get("is_end", True):
            break
        time.sleep(0.1)
    return out


def survival_row(doc: dict, category: str, query: str) -> dict | None:
    name = doc["place_name"]
    cat_name = doc.get("category_name", "")
    # 검색어와 무관한 업종 제거 (예: '공영주차장' 검색 시 주차장이 아닌 곳)
    must = {
        "laundry": ("세탁", "빨래", "워시", "크린토피아"),
        "print": ("프린트", "복사", "인쇄", "출력"),
        "pharmacy": ("약국",),
        "parking": ("주차",),
        "battery": ("배터리", "충전", "포터블", "아잉"),
        "toilet": ("화장실",),
    }[category]
    if not any(k in name or k in cat_name for k in must):
        return None
    # 카테고리 우선순위 보호:
    #  - 상호에 '화장실'이 있으면 그 장소는 화장실이다('○○공영주차장 개방화장실'은 주차장 안의 화장실). 주차장으로 분류하지 않는다.
    #  - 화장실 키워드 검색에서 주차장 자체(PK6, 상호에 '주차'만 있고 '화장실' 없음)는 절대 toilet 이 되지 않는다.
    if category == "parking" and "화장실" in name:
        return None
    if category == "toilet" and "화장실" not in name and (doc.get("category_group_code") == "PK6" or "주차" in name):
        return None
    if category == "parking" and "거주자" in name:
        return None  # 거주자우선주차장은 일반 이용 불가 → 영구 제외

    tags = list(DEFAULT_TAGS[category])
    badge = ""
    if category == "laundry":
        badge = "24시" if "24" in name else "코인세탁"
    elif category == "print":
        badge = "무인"
    elif category == "pharmacy":
        badge = "심야 확인"
        tags[1] = "#심야약국" if ("심야" in name or "24" in name) else "#심야영업확인"
    elif category == "parking":
        badge = "공영"
        tags[0] = "#공영주차장"
        if "기계식" in name or "타워" in name:
            tags[1] = "#기계식주의"
        elif "지하" in name:
            tags[1] = "#지하주차장"
        elif "노상" in name:
            tags[1] = "#노상주차"
        else:
            tags[1] = "#주차방식확인"
    elif category == "battery":
        badge = "대여"
    elif category == "toilet":
        badge = "화장실"
        if "공중" in name:
            tags[0] = "#공중화장실"

    return base_row(doc, "survival", category, badge, tags, SUMMARY[category], [])


def nopo_row(doc: dict, query: str) -> dict | None:
    name = doc["place_name"]
    cat_name = doc.get("category_name", "")
    if not cat_name.startswith("음식점"):
        return None

    extra: list[str] = []
    category = "general"
    if any(k in name or k in cat_name for k in ("국밥", "해장", "순대", "설렁탕", "곰탕", "해장국")):
        category = "soup"
    elif any(k in name or k in cat_name for k in ("포차", "주점", "호프", "술집", "이자카야")):
        category = "pocha"
    elif any(k in cat_name for k in ("분식", "칼국수", "국수", "한식 > 백반", "기사식당")) or "기사식당" in name:
        category = "solo"
    if category != "solo" and any(k in name for k in ("기사식당", "백반", "칼국수", "국수")):
        extra.append("solo")

    years = None
    m = re.search(r"(\d{2})\s*년", name)  # 상호에 '30년전통' 등이 있을 때만 업력으로 인정
    if m and 10 <= int(m.group(1)) <= 99:
        years = int(m.group(1))
    if years and years >= 20:
        extra.append("veteran")
    badge = f"업력 {years}년" if years else "노포 후보"

    kw_tag = {"노포": "#노포키워드", "본점": "#본점", "기사식당": "#기사식당", "전통": "#전통"}[query]
    sub = cat_name.split(" > ")[-1] if " > " in cat_name else "음식점"
    tags = [f"#{re.sub(r'[^0-9A-Za-z가-힣]', '', sub)[:8] or '음식점'}", kw_tag, "#실방문검증전"]

    summary = (
        f"'{query}' 키워드로 찾은 1차 후보예요. 업력과 비광고 실방문 후기 검증 전이라 방문 전 확인이 필요해요."
        if not years
        else f"상호에 {years}년 전통을 내세우는 후보예요. 비광고 실방문 후기 검증 전이에요."
    )
    return base_row(doc, "nopo", category, badge, tags, summary, extra)


def base_row(doc: dict, mode: str, category: str, badge: str, tags: list[str], summary: str, extra: list[str]) -> dict:
    return {
        "kakao_id": doc["id"],
        "mode": mode,
        "category": category,
        "extra": sorted(set(extra)),
        "name": doc["place_name"],
        "address": doc.get("road_address_name") or doc.get("address_name"),
        "phone": doc.get("phone") or None,
        "place_url": doc.get("place_url"),
        "badge": badge,
        "tags": tags[:3],
        "summary": summary,
        "lat": float(doc["y"]),
        "lng": float(doc["x"]),
        "source": "kakao",
    }


def collect(hubs: dict[str, tuple[float, float]], only: set[str] | None = None) -> dict[str, dict]:
    rows: dict[str, dict] = {}
    for hub, (lat, lng) in hubs.items():
        print(f"[{hub}]")
        for query, category in SURVIVAL_QUERIES:
            if only and category not in only:
                continue
            docs = kakao_search(query, lat, lng)
            n = 0
            for d in docs:
                row = survival_row(d, category, query)
                if row and row["kakao_id"] not in rows:
                    rows[row["kakao_id"]] = row
                    n += 1
            print(f"  survival/{category:<9} {query}: {len(docs)}건 → 신규 {n}")
        for query in NOPO_QUERIES:
            if only and "nopo" not in only:
                continue
            docs = kakao_search(query, lat, lng, group="FD6")
            n = 0
            for d in docs:
                row = nopo_row(d, query)
                if row and row["kakao_id"] not in rows and row["kakao_id"] not in EXCLUDED_IDS:
                    rows[row["kakao_id"]] = row
                    n += 1
            print(f"  nopo/{query}: {len(docs)}건 → 신규 {n}")
    return rows


TOILET_DENSE_QUERIES = ["공중화장실", "개방화장실", "공공화장실", "공원 화장실", "지하철역 화장실"]
# 거점 중심 + 6방향(약 1.2km) 보조 중심 → 반경 1km 검색으로 카카오 키워드 검색의 45건 한도를 우회해 촘촘히 수집
RING = [(0, 0), (0.011, 0), (-0.011, 0), (0.0055, 0.0145), (0.0055, -0.0145), (-0.0055, 0.0145), (-0.0055, -0.0145)]


def collect_dense_toilets(hubs: dict[str, tuple[float, float]], rows: dict[str, dict]) -> None:
    for hub, (lat, lng) in hubs.items():
        n = 0
        for dlat, dlng in RING:
            for query in TOILET_DENSE_QUERIES:
                for d in kakao_search(query, lat + dlat, lng + dlng, radius=1000):
                    row = survival_row(d, "toilet", query)
                    if row and row["kakao_id"] not in rows:
                        rows[row["kakao_id"]] = row
                        n += 1
        print(f"[{hub}] 화장실 밀집 수집 신규 {n}")


def upsert(rows: list[dict]) -> None:
    from supabase import create_client

    client = create_client(SUPABASE_URL, SERVICE_KEY)
    # 이미 있는 행은 건너뛴다(insert-only): enrich_*.py 가 채운 요약·태그·요금(fee:)·업력과
    # 다른 카테고리(parking)로 확정된 행을 재수집이 덮어쓰지 못하게 한다.
    groups = [
        ([r for r in rows if r["mode"] == "survival"], True),
        ([r for r in rows if r["mode"] == "nopo"], True),
    ]
    for group, ignore_dup in groups:
        for i in range(0, len(group), 200):
            chunk = group[i : i + 200]
            client.table("bml_places").upsert(chunk, on_conflict="kakao_id", ignore_duplicates=ignore_dup).execute()
            print(f"  upsert {group[0]['mode']} {i + len(chunk)}/{len(group)}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="DB에 쓰지 않고 JSON 파일로만 저장")
    ap.add_argument("--hubs", nargs="*", help="수집할 거점 이름 (기본: 전체)")
    ap.add_argument("--dense-toilets", action="store_true", help="거점 주변 6방향 보조 중심까지 화장실을 촘촘히 수집")
    ap.add_argument("--categories", nargs="*", help="수집할 카테고리만 (예: toilet battery nopo). 기본: 전체")
    args = ap.parse_args()

    if not KAKAO_KEY:
        print("KAKAO_REST_API_KEY 가 .env.local 에 없습니다.", file=sys.stderr)
        return 1
    hubs = {k: v for k, v in HUBS.items() if not args.hubs or k in args.hubs}
    if not hubs:
        print(f"알 수 없는 거점. 사용 가능: {', '.join(HUBS)}", file=sys.stderr)
        return 1

    collected = collect(hubs, set(args.categories) if args.categories else None)
    if args.dense_toilets:
        collect_dense_toilets(hubs, collected)
    rows = list(collected.values())
    surv = sum(r["mode"] == "survival" for r in rows)
    print(f"\n총 {len(rows)}건 (생존 {surv} / 노포 {len(rows) - surv})")

    if args.dry_run:
        out = ROOT / "scripts" / "out"
        out.mkdir(exist_ok=True)
        (out / "places.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"dry-run: {out / 'places.json'} 저장")
        return 0

    if not (SUPABASE_URL and SERVICE_KEY):
        print("Supabase 환경변수가 없습니다.", file=sys.stderr)
        return 1
    upsert(rows)
    print("완료")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
