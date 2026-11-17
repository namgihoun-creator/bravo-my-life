import { NextRequest, NextResponse } from "next/server";

const KAKAO = "https://dapi.kakao.com/v2/local/search";

interface KakaoDoc {
  place_name?: string;
  address_name: string;
  road_address_name?: string;
  x: string;
  y: string;
}

async function kakao(path: "keyword.json" | "address.json", q: string, key: string) {
  const url = new URL(`${KAKAO}/${path}`);
  url.searchParams.set("query", q);
  url.searchParams.set("size", "5");
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${key}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`kakao ${res.status}`);
  const data = (await res.json()) as { documents: KakaoDoc[] };
  return data.documents;
}

/** GET /api/geocode?q=부천역 → 카카오 로컬 API로 동네/역 이름을 위경도로 변환 (키는 서버에서만 사용) */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 1 || q.length > 50) {
    return NextResponse.json({ error: "검색어는 1~50자로 입력해 주세요." }, { status: 400 });
  }
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "서버에 카카오 API 키가 설정되지 않았어요." }, { status: 500 });
  }

  try {
    let docs = await kakao("keyword.json", q, key);
    if (docs.length === 0) docs = await kakao("address.json", q, key);

    const results = docs.map((d) => ({
      name: d.place_name ?? d.address_name,
      address: d.road_address_name || d.address_name,
      lat: Number(d.y),
      lng: Number(d.x),
    }));
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "위치 검색에 실패했어요. 잠시 후 다시 시도해 주세요." }, { status: 502 });
  }
}
