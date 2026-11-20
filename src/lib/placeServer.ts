import { cacheLife } from "next/cache";
import { feeEntries, foodLabel, isVisiblePlace, yearsInBusiness, type Place } from "@/data/places";
import { getSupabase } from "@/lib/supabase";

/**
 * 상세 페이지·sitemap 용 서버 조회 (publishable 키만 사용).
 * RLS 가 `select using (true)` 이고 `is_active=false` 행도 보이므로 반드시 컬럼을 명시하고 is_active 로 거른다.
 * 가져오는 컬럼은 화면에 쓰는 것만이다(source·source_key 같은 내부 컬럼은 제외).
 * phone(업소 공개 번호)·kakao_id 는 상세 페이지의 전화·카카오맵 버튼용으로 의도적으로 포함한다.
 */
const PUBLIC_COLUMNS =
  "id,mode,category,extra,name,address,place_url,badge,tags,summary,lat,lng,feedback,open_year,last_synced_at,reported_issue,closure_reports,phone,kakao_id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_REPORT_TAG = "#유저제보";

/** 노포 상세 페이지로 보여 줄 수 있는 장소(활성 + 앱이 보이는 기준과 동일). 없으면 null. */
export async function getPlaceById(id: string): Promise<Place | null> {
  "use cache";
  cacheLife("hours");
  if (!UUID.test(id)) return null;
  const { data, error } = await getSupabase()
    .from("bml_places")
    .select(PUBLIC_COLUMNS)
    .eq("id", id)
    .eq("is_active", true)
    .eq("mode", "nopo")
    .maybeSingle();
  if (error) throw new Error(`장소 조회 실패: ${error.message}`);
  if (!data) return null;
  const place = { ...(data as Omit<Place, "distance_m">), distance_m: 0 } as Place;
  return isVisiblePlace(place) ? place : null;
}

/** 검색 엔진에 색인할 만한 장소인가: 폐업 의심·제보 플래그가 없고 유저 제보(미검증)가 아닌 곳 */
export function isIndexable(p: Place): boolean {
  return p.reported_issue !== "closed" && !p.tags.includes(USER_REPORT_TAG);
}

export interface IndexableRef {
  id: string;
  lastModified: string | null;
}

/** sitemap 용: 활성·검증된 노포(업력 10년 이상)·폐업 의심 아님. 유저 제보는 제외한다. */
export async function getIndexablePlaces(): Promise<IndexableRef[]> {
  "use cache";
  cacheLife("days");
  const maxYear = new Date().getFullYear() - 10;
  const out: IndexableRef[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await getSupabase()
      .from("bml_places")
      .select("id,last_synced_at,reported_issue,tags")
      .eq("mode", "nopo")
      .eq("is_active", true)
      .not("open_year", "is", null)
      .lte("open_year", maxYear)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`sitemap 조회 실패: ${error.message}`);
    for (const r of data ?? []) {
      if (r.reported_issue === "closed" || (r.tags ?? []).includes(USER_REPORT_TAG)) continue;
      out.push({ id: r.id as string, lastModified: (r.last_synced_at as string | null) ?? null });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

/* ───────────── 상세 페이지 부가 정보 (기존 RPC 재사용 · 'days' 캐시로 크롤러 방문 때 DB 호출을 막는다) ───────────── */

export interface NearbyParking {
  id: string;
  name: string;
  distanceM: number;
  /** 요금 요약 (없으면 null → '요금 정보 없음') */
  fee: string | null;
  free: boolean;
}

/** 가게 좌표 기준 도보권(500m, 없으면 800m) 공영주차장 최대 2곳. 없으면 빈 배열(박스를 숨긴다). */
export async function getNearbyParking(lat: number, lng: number): Promise<NearbyParking[]> {
  "use cache";
  cacheLife("days");
  for (const radius of [500, 800]) {
    const { data, error } = await getSupabase().rpc("bml_get_nearby_places", {
      p_lat: lat,
      p_lng: lng,
      p_radius_m: radius,
      p_mode: "survival",
      p_limit: 300,
    });
    if (error) throw new Error(`주변 주차장 조회 실패: ${error.message}`);
    const found = ((data ?? []) as Place[]).filter((p) => p.category === "parking").slice(0, 2);
    if (found.length > 0) {
      return found.map((p) => {
        const fee = feeEntries(p)[0] ?? null;
        return {
          id: p.id,
          name: p.name,
          distanceM: Math.round(p.distance_m),
          fee: fee ? fee.text : null,
          free: fee ? fee.free : false,
        };
      });
    }
  }
  return [];
}

export interface NearbyNopo {
  id: string;
  name: string;
  food: string | null;
  years: number | null;
  distanceM: number;
}

/** 반경 1km 이내 다른 노포 최대 3곳(거리순). 404·noindex 로 이어지는 곳(미검증·폐업 의심·유저 제보)은 연결하지 않는다. */
export async function getNearbyNopo(id: string, lat: number, lng: number): Promise<NearbyNopo[]> {
  "use cache";
  cacheLife("days");
  const { data, error } = await getSupabase().rpc("bml_get_nearby_places", {
    p_lat: lat,
    p_lng: lng,
    p_radius_m: 1000,
    p_mode: "nopo",
    p_limit: 60,
  });
  if (error) throw new Error(`주변 노포 조회 실패: ${error.message}`);
  return ((data ?? []) as Place[])
    .filter((p) => p.id !== id && p.mode === "nopo" && isVisiblePlace(p) && isIndexable(p))
    .slice(0, 3)
    .map((p) => ({
      id: p.id,
      name: p.name,
      food: foodLabel(p),
      years: yearsInBusiness(p),
      distanceM: Math.round(p.distance_m),
    }));
}
