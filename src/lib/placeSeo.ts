import { foodLabel, yearsInBusiness, type Place } from "@/data/places";
import { placeUrl } from "@/lib/site";

/** 검증된 사실만 쓴다: 영업시간(공식 0%·LLM 추정)·평점은 제목·설명·구조화 데이터에 넣지 않는다. */

/** '서울 성동구 성덕정15길 6-19' → '서울 성동구' (모르면 null) */
export function regionOf(address: string | null): string | null {
  if (!address) return null;
  const t = address.trim().split(/\s+/);
  return t.length >= 2 ? `${t[0]} ${t[1]}` : null;
}

/** 'food:한식 · 고기·구이' → { group: '한식', sub: '고기·구이' } */
export function foodParts(p: Place): { group: string; sub: string | null } | null {
  const label = foodLabel(p);
  if (!label) return null;
  const [group, sub] = label.split(" · ");
  return { group, sub: sub ?? null };
}

export function placeTitle(p: Place): string {
  const years = yearsInBusiness(p);
  const food = foodParts(p);
  const bits = [regionOf(p.address), food ? (food.sub ?? food.group) : null].filter(Boolean).join(" ");
  const tail = years !== null ? `업력 ${years}년 노포` : "노포";
  return `${p.name} · ${bits ? `${bits} ` : ""}${tail}`;
}

export function placeDescription(p: Place): string {
  const years = yearsInBusiness(p);
  const region = regionOf(p.address);
  const food = foodParts(p);
  const what = food ? `${food.group}${food.sub ? `(${food.sub})` : ""} 노포` : "노포";
  const base = `${region ? `${region}의 ` : ""}${what} ${p.name}`;
  const proof = p.open_year ? ` 인허가 ${p.open_year}년 기준 업력 ${years}년.` : "";
  return `${base}.${proof} 주소와 길찾기를 한 번에 — 브라보 마이 라이프`;
}

/** schema.org Restaurant (영업시간·평점 없음) */
export function restaurantJsonLd(p: Place) {
  const food = foodParts(p);
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: p.name,
    url: placeUrl(p.id),
    ...(p.address ? { address: { "@type": "PostalAddress", streetAddress: p.address, addressCountry: "KR" } } : {}),
    geo: { "@type": "GeoCoordinates", latitude: p.lat, longitude: p.lng },
    ...(food ? { servesCuisine: food.group } : {}),
    ...(p.open_year ? { foundingDate: String(p.open_year) } : {}),
  };
}
