import { NextRequest, NextResponse } from "next/server";
import { clientIp, createRateLimiter, inKorea, isSameOrigin, kakaoJson } from "@/lib/apiGuard";
import { LIVE_SERVER_RADIUS_M, snapLive, type LiveCategory, type LiveDoc } from "@/lib/livePlaces";

/**
 * GET /api/live-nearby?lat&lng — DB 에 데이터가 없는 지역(생존 모드)의 실시간 폴백.
 * 카카오 로컬 카테고리 검색 PM9(약국)·PK6(주차장)만 반경 1.5km 에서 거리순으로 가져온다(키는 서버에서만 사용).
 * 남용 방지: 동일 출처 확인, 한국 좌표 범위, IP당 분당 제한, 좌표를 0.005° 격자로 맞춰 같은 격자 요청을 CDN 캐시로 흡수한다.
 * 결과는 DB 에 저장하지 않는다(캐시만). 이름에 '거주자'가 든 주차장은 일반 이용 불가라 제외한다.
 */

const rateLimited = createRateLimiter(30, 60 * 1000);
const CACHE = "public, s-maxage=21600, stale-while-revalidate=86400";
const GROUPS: { code: "PM9" | "PK6"; category: LiveCategory }[] = [
  { code: "PM9", category: "pharmacy" },
  { code: "PK6", category: "parking" },
];

interface KakaoPlace {
  id?: string;
  place_name?: string;
  road_address_name?: string;
  address_name?: string;
  x?: string;
  y?: string;
  distance?: string;
}

async function search(code: string, category: LiveCategory, lat: number, lng: number, key: string) {
  const url = new URL("https://dapi.kakao.com/v2/local/search/category.json");
  url.searchParams.set("category_group_code", code);
  url.searchParams.set("x", String(lng));
  url.searchParams.set("y", String(lat));
  url.searchParams.set("radius", String(LIVE_SERVER_RADIUS_M));
  url.searchParams.set("sort", "distance");
  url.searchParams.set("size", "15");
  const data = (await kakaoJson(url.toString(), key)) as { documents?: KakaoPlace[] };
  const out: (LiveDoc & { d: number })[] = [];
  for (const p of data.documents ?? []) {
    const lat2 = Number(p.y);
    const lng2 = Number(p.x);
    if (!p.id || !/^\d{1,20}$/.test(p.id) || !p.place_name || !Number.isFinite(lat2) || !Number.isFinite(lng2)) continue;
    if (category === "parking" && p.place_name.includes("거주자")) continue;
    out.push({
      id: p.id,
      name: p.place_name.slice(0, 60),
      category,
      address: (p.road_address_name || p.address_name || null)?.slice(0, 100) ?? null,
      lat: lat2,
      lng: lng2,
      d: Number(p.distance) || 0,
    });
  }
  return out;
}

export async function GET(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "허용되지 않은 요청이에요." }, { status: 403 });
  }
  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "잠시 후 다시 시도해 주세요." }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "서버 설정이 완료되지 않았어요." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  const lat0 = Number(req.nextUrl.searchParams.get("lat"));
  const lng0 = Number(req.nextUrl.searchParams.get("lng"));
  if (!inKorea(lat0, lng0)) {
    return NextResponse.json({ error: "위치를 확인할 수 없어요." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const { lat, lng } = snapLive(lat0, lng0);

  try {
    const lists = await Promise.all(GROUPS.map((g) => search(g.code, g.category, lat, lng, key)));
    const places = lists
      .flat()
      .sort((a, b) => a.d - b.d)
      .slice(0, 30)
      .map((p) => ({ id: p.id, name: p.name, category: p.category, address: p.address, lat: p.lat, lng: p.lng }));
    return NextResponse.json({ places }, { headers: { "Cache-Control": CACHE } });
  } catch {
    return NextResponse.json({ error: "주변 검색에 실패했어요." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
