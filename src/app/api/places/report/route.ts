import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/places/report — '우리 동네 장소 제보'
 * 로그인 없는 서비스라 서버에서만 service role 키로 insert 한다 (브라우저에는 insert 권한이 없다).
 * 남용 방지: 동일 출처 확인, 허니팟, IP당 시간당 5건(서버리스에서는 best-effort), 입력 검증, 중복 장소 차단.
 */

const CATEGORIES: Record<string, string[]> = {
  survival: ["laundry", "print", "pharmacy", "parking", "carwash", "battery", "toilet"],
  nopo: ["soup", "pocha", "solo", "general"],
};

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

/** 제어문자·태그 제거, 공백 정리 */
function clean(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const SPAM = /https?:|www\.|[a-z0-9-]+\.(com|net|kr|io|me|co)\b|@|카톡|오픈채팅|텔레그램/i;

function inKorea(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
}

async function kakaoJson(url: string, key: string) {
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`kakao ${res.status}`);
  return res.json();
}

/** 좌표 → 도로명/지번 주소 (실패해도 제보는 계속 진행) */
async function reverse(lat: number, lng: number, key: string): Promise<string | null> {
  try {
    const d = await kakaoJson(
      `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`,
      key,
    );
    const doc = d.documents?.[0];
    return doc?.road_address?.address_name ?? doc?.address?.address_name ?? null;
  } catch {
    return null;
  }
}

/** 주소/장소 검색어 → 좌표 */
async function forward(query: string, key: string) {
  const q = encodeURIComponent(query);
  let d = await kakaoJson(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${q}&size=1`, key);
  let doc = d.documents?.[0];
  if (!doc) {
    d = await kakaoJson(`https://dapi.kakao.com/v2/local/search/address.json?query=${q}&size=1`, key);
    doc = d.documents?.[0];
  }
  if (!doc) return null;
  return {
    lat: Number(doc.y),
    lng: Number(doc.x),
    address: (doc.road_address_name || doc.address_name || null) as string | null,
  };
}

const norm = (s: string) => s.replace(/[\s()\-_.·]/g, "").toLowerCase();

export async function POST(req: NextRequest) {
  // 같은 출처에서 온 요청만 허용
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) {
    return NextResponse.json({ error: "허용되지 않은 요청이에요." }, { status: 403 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "제보는 1시간에 5건까지 가능해요. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const kakaoKey = process.env.KAKAO_REST_API_KEY;
  if (!url || !serviceKey || !kakaoKey) {
    return NextResponse.json({ error: "서버 설정이 완료되지 않았어요." }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  // 허니팟: 사람은 채우지 않는 필드. 봇이면 성공한 척하고 저장하지 않는다.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const mode = clean(body.mode, 10);
  const category = clean(body.category, 20);
  const name = clean(body.name, 40);
  const tip = clean(body.tip, 60);

  if (!CATEGORIES[mode]?.includes(category)) {
    return NextResponse.json({ error: "모드와 카테고리를 확인해 주세요." }, { status: 400 });
  }
  if (name.length < 2) {
    return NextResponse.json({ error: "장소명을 2자 이상 입력해 주세요." }, { status: 400 });
  }
  if (SPAM.test(name) || SPAM.test(tip)) {
    return NextResponse.json({ error: "링크나 연락처는 제보에 넣을 수 없어요." }, { status: 400 });
  }

  // 좌표: GPS/선택 좌표가 오면 사용, 없으면 검색어(query)를 서버에서 변환
  let lat = Number(body.lat);
  let lng = Number(body.lng);
  let address: string | null = null;
  try {
    if (inKorea(lat, lng)) {
      address = await reverse(lat, lng, kakaoKey);
    } else {
      const query = clean(body.query, 60);
      if (!query) {
        return NextResponse.json({ error: "위치를 선택하거나 검색해 주세요." }, { status: 400 });
      }
      const found = await forward(query, kakaoKey);
      if (!found || !inKorea(found.lat, found.lng)) {
        return NextResponse.json({ error: "위치를 찾지 못했어요. 주소나 건물명으로 다시 검색해 주세요." }, { status: 422 });
      }
      ({ lat, lng, address } = found);
    }
  } catch {
    return NextResponse.json({ error: "위치 변환에 실패했어요. 잠시 후 다시 시도해 주세요." }, { status: 502 });
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 100m 안에 같은 이름이 이미 있으면 중복으로 본다
  const { data: near } = await supabase.rpc("bml_get_nearby_places", {
    p_lat: lat,
    p_lng: lng,
    p_radius_m: 100,
    p_mode: null,
    p_limit: 100,
  });
  if ((near as { name: string }[] | null)?.some((p) => norm(p.name) === norm(name))) {
    return NextResponse.json({ error: "이미 등록된 장소예요." }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("bml_places")
    .insert({
      mode,
      category,
      name,
      address,
      lat,
      lng,
      badge: "유저 제보",
      tags: ["#유저제보"],
      summary: tip || "이웃이 제보한 장소예요. 방문 전에 한 번 더 확인해 주세요.",
      source: "user",
    })
    .select("id")
    .single();

  if (error) {
    console.error("report insert", error);
    return NextResponse.json({ error: "저장에 실패했어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: data.id });
}
