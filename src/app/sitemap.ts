import type { MetadataRoute } from "next";
import { getIndexablePlaces } from "@/lib/placeServer";
import { SITE_URL, placeUrl } from "@/lib/site";

/** 색인 대상: 활성·검증된 노포(업력 10년 이상)·폐업 의심/유저 제보 아님. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const places = await getIndexablePlaces();
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    ...places.map((p) => ({
      url: placeUrl(p.id),
      ...(p.lastModified ? { lastModified: new Date(p.lastModified) } : {}),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
