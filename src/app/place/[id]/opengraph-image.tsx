import { ImageResponse } from "next/og";
import { cacheLife } from "next/cache";
import { ageTier, yearsInBusiness } from "@/data/places";
import { getPlaceById } from "@/lib/placeServer";
import { foodParts, regionOf } from "@/lib/placeSeo";

export const alt = "브라보 마이 라이프 노포 상세";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// 노포 모드 토큰(globals.css)과 같은 값 — OG 는 CSS 변수를 못 읽어 여기서만 hex 를 쓴다.
const BG = "#faf4e8";
const INK = "#2b1a0e";
const MUTED = "#6b5744";
const PRIMARY = "#8a3b12";
const TIER: Record<number, { bg: string; fg: string }> = {
  1: { bg: "#292524", fg: "#fef3c7" },
  2: { bg: "#b45309", fg: "#ffffff" },
  3: { bg: "#4c0519", fg: "#fde68a" },
};

/** satori 는 한글 글리프가 없는 기본 폰트를 쓰므로 앱과 같은 Pretendard 를 받아 쓴다(캐시). */
async function loadFont(): Promise<ArrayBuffer | null> {
  "use cache";
  cacheLife("max");
  try {
    const res = await fetch("https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/public/static/Pretendard-Bold.otf");
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const place = await getPlaceById(id);
  const font = await loadFont();
  const years = place ? yearsInBusiness(place) : null;
  const tier = years !== null ? TIER[ageTier(years)] : null;
  const food = place ? foodParts(place) : null;
  const sub = place ? [regionOf(place.address), food?.group, food?.sub].filter(Boolean).join(" · ") : "";
  const name = place?.name ?? "브라보 마이 라이프";
  const nameSize = name.length > 16 ? 72 : name.length > 10 ? 88 : 104;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: BG, padding: 72 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 32, fontWeight: 700, color: PRIMARY }}>
          <div style={{ width: 16, height: 16, borderRadius: 8, background: PRIMARY }} />
          브라보 마이 라이프 · 찐노포
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {tier && years !== null && (
            <div style={{ display: "flex" }}>
              <div style={{ display: "flex", padding: "10px 28px", borderRadius: 999, fontSize: 40, fontWeight: 700, background: tier.bg, color: tier.fg }}>
                업력 {years}년
              </div>
            </div>
          )}
          <div style={{ display: "flex", fontSize: nameSize, fontWeight: 700, color: INK, lineHeight: 1.15, letterSpacing: -2 }}>{name}</div>
          {sub && <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: MUTED }}>{sub}</div>}
        </div>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: MUTED }}>인허가 기준으로 확인한 광고 없는 로컬 노포 가이드</div>
      </div>
    ),
    { ...size, ...(font ? { fonts: [{ name: "Pretendard", data: font, weight: 700 as const, style: "normal" as const }] } : {}) },
  );
}
