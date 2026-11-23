import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { HUBS, distanceM } from "@/data/places";
import { areaCell } from "@/lib/areaCell";
import { clientIp, createRateLimiter, inKorea, isSameOrigin, kakaoJson } from "@/lib/apiGuard";

/**
 * POST /api/area-requests — '이 동네 데이터 요청하기' (가장 가까운 거점이 멀어 지원하지 않는 지역의 요청 집계)
 * - 정확한 좌표는 저장하지 않고 0.02° 격자 중심만 저장한다. 동네 이름은 서버가 카카오 coord2regioncode 로 채운다(클라이언트 값은 믿지 않는다).
 * - 같은 사람(IP+UA 해시)의 같은 격자 요청은 unique(cell_key, voter_hash) + ON CONFLICT DO NOTHING 으로 1표.
 * - 남용 방지: 동일 출처 확인, 허니팟, IP당 시간당 5건(서버리스에서는 best-effort), 한국 좌표 범위, 이미 지원하는 지역(거점 25km 안) 거절.
 * - 응답은 성공·중복 모두 { ok: true, cellKey } 라 클라이언트는 같은 상태(접수됨)로 보여 준다.
 */

const rateLimited = createRateLimiter(5);
const COVERED_M = 25_000; // 클라이언트 배너 기준(30km)보다 약간 낮춰 격자 중심 오차를 흡수한다

/** 격자 중심의 행정동 이름(예: '제주특별자치도 제주시 연동'). 실패해도 요청은 저장한다. */
async function regionName(lat: number, lng: number, key: string): Promise<string | null> {
  try {
    const d = await kakaoJson(`https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${lng}&y=${lat}`, key);
    const docs = (d.documents ?? []) as { region_type?: string; region_1depth_name?: string; region_2depth_name?: string; region_3depth_name?: string }[];
    const doc = docs.find((x) => x.region_type === "H") ?? docs[0];
    if (!doc) return null;
    const name = [doc.region_1depth_name, doc.region_2depth_name, doc.region_3depth_name].filter(Boolean).join(" ").slice(0, 60);
    return name || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "허용되지 않은 요청이에요." }, { status: 403 });
  }
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "요청은 1시간에 5건까지 가능해요. 잠시 후 다시 시도해 주세요." }, { status: 429 });
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

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!inKorea(lat, lng)) {
    return NextResponse.json({ error: "위치를 확인할 수 없어요." }, { status: 400 });
  }

  const cell = areaCell(lat, lng);
  const nearest = HUBS.reduce<{ name: string; m: number } | null>((best, h) => {
    const m = distanceM(cell.lat, cell.lng, h.lat, h.lng);
    return !best || m < best.m ? { name: h.name, m } : best;
  }, null);
  if (!nearest || nearest.m < COVERED_M) {
    return NextResponse.json({ error: "이미 지원하는 지역이에요. 가까운 거점으로 이동해 보세요." }, { status: 400 });
  }

  const salt = process.env.AREA_REQUEST_SALT ?? serviceKey;
  const voterHash = createHash("sha256")
    .update(`${ip}|${req.headers.get("user-agent") ?? ""}|${salt}`)
    .digest("hex");
  const areaName = await regionName(cell.lat, cell.lng, kakaoKey);

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await supabase.from("bml_area_requests").upsert(
    {
      cell_key: cell.key,
      voter_hash: voterHash,
      lat_c: cell.lat,
      lng_c: cell.lng,
      area_name: areaName,
      nearest_hub: nearest.name,
      nearest_hub_m: Math.round(nearest.m),
    },
    { onConflict: "cell_key,voter_hash", ignoreDuplicates: true },
  );
  if (error) {
    console.error("area request insert", error.code, error.message);
    return NextResponse.json({ error: "저장에 실패했어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, cellKey: cell.key });
}
