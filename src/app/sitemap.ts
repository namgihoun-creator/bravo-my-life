import type { MetadataRoute } from "next";
import { getIndexablePlaces } from "@/lib/placeServer";
import { SITE_URL, placeUrl } from "@/lib/site";

/** 색인 대상: 활성·검증된 노포(업력 10년 이상)·폐업 의심/유저 제보 아님. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const places = await getIndexablePlaces();
  // 홈의 lastModified: 가장 최근 데이터 현행화 시각(없으면 생략)
  const latest = places.reduce<number>((m, p) => Math.max(m, p.lastModified ? Date.parse(p.lastModified) || 0 : 0), 0);
  return [
    { url: SITE_URL, ...(latest ? { lastModified: new Date(latest) } : {}), changeFrequency: "weekly", priority: 1 },
    ...places.map((p) => ({
      url: placeUrl(p.id),
      ...(p.lastModified ? { lastModified: new Date(p.lastModified) } : {}),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
