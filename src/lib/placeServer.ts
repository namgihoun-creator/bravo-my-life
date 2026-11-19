import { cacheLife } from "next/cache";
import { isVisiblePlace, type Place } from "@/data/places";
import { getSupabase } from "@/lib/supabase";

/**
 * 상세 페이지·sitemap 용 서버 조회 (publishable 키만 사용).
 * RLS 가 `select using (true)` 이고 `is_active=false` 행도 보이므로 반드시 컬럼을 명시하고 is_active 로 거른다.
 * phone·source·source_key·kakao_id 같은 내부 컬럼은 가져오지 않는다.
 */
const PUBLIC_COLUMNS =
  "id,mode,category,extra,name,address,place_url,badge,tags,summary,lat,lng,feedback,open_year,last_synced_at,reported_issue,closure_reports";

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
