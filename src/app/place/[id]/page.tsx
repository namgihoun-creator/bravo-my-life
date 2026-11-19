import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Award, TriangleAlert, UtensilsCrossed } from "lucide-react";
import AddressLine from "@/components/AddressLine";
import ModeAttr from "@/components/ModeAttr";
import NavigationButton from "@/components/NavigationButton";
import { ageTier, fieldInfo, syncedLabel, yearsInBusiness, type Place } from "@/data/places";
import { getIndexablePlaces, getPlaceById, isIndexable } from "@/lib/placeServer";
import { foodParts, placeDescription, placeTitle, restaurantJsonLd } from "@/lib/placeSeo";
import { placeUrl } from "@/lib/site";

type Props = { params: Promise<{ id: string }> };

/**
 * Cache Components: 일부 id 만 빌드 때 만들고(최소 1개 필요), 나머지는 첫 요청에서 렌더링해 저장한다.
 * 데이터 조회는 placeServer 의 'use cache' 함수가 맡는다. 영업 중 여부처럼 시각에 따라 변하는 값은 서버에서 그리지 않는다.
 */
export async function generateStaticParams() {
  const sample = (await getIndexablePlaces()).slice(0, 20).map((p) => ({ id: p.id }));
  return sample.length > 0 ? sample : [{ id: "00000000-0000-0000-0000-000000000000" }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const place = await getPlaceById(id);
  if (!place) return { title: "찾을 수 없는 장소", robots: { index: false, follow: false } };
  const title = placeTitle(place);
  const description = placeDescription(place);
  return {
    title,
    description,
    alternates: { canonical: `/place/${id}` },
    robots: isIndexable(place) ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      type: "website",
      locale: "ko_KR",
      siteName: "Bravo My Life",
      url: placeUrl(id), // 루트 layout 의 openGraph.url(홈)을 덮어쓴다
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PlacePage({ params }: Props) {
  const { id } = await params;
  const place = await getPlaceById(id);
  if (!place) notFound();
  return <PlaceDetail place={place} />;
}

function PlaceDetail({ place }: { place: Place }) {
  const years = yearsInBusiness(place);
  const tier = years !== null ? ageTier(years) : null;
  const food = foodParts(place);
  const info = fieldInfo(place);
  const hasInfo = info.hours || info.breakTime || info.closedDays.length > 0;
  const jsonLd = JSON.stringify(restaurantJsonLd(place)).replace(/</g, "\\u003c");

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-10 pt-3 md:max-w-2xl">
      <ModeAttr mode="nopo" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />

      <Link href="/" className="inline-flex min-h-[44px] items-center gap-1 text-label font-semibold text-primary">
        <ArrowLeft size={16} aria-hidden />
        내 주변 노포 지도로
      </Link>

      <article className="theme-t mt-1 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <div className="flex items-start justify-between gap-2">
          <h1 className="min-w-0 text-title2 font-bold tracking-[-0.02em] text-ink [overflow-wrap:anywhere]">{place.name}</h1>
          {tier && (
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-caption font-bold age-badge age-badge-${tier}`}
            >
              <Award size={12} strokeWidth={2} aria-hidden />
              업력 {years}년
            </span>
          )}
        </div>

        {place.reported_issue && (
          <p
            role="status"
            className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-lg border border-warning bg-surface px-2 py-1 text-caption font-bold text-warning"
          >
            <TriangleAlert size={12} strokeWidth={2} className="shrink-0" aria-hidden />
            <span className="min-w-0 [overflow-wrap:anywhere]">폐업·변경 제보됨 — 방문 전 확인해 주세요</span>
          </p>
        )}

        {food && (
          <p className="mt-0.5 flex items-center gap-1 text-label font-semibold text-muted">
            <UtensilsCrossed size={14} className="shrink-0" aria-hidden />
            <span className="min-w-0 [overflow-wrap:anywhere]">{[food.group, food.sub].filter(Boolean).join(" · ")}</span>
          </p>
        )}

        {place.address && <AddressLine address={place.address} />}

        {place.summary && <p className="mt-3 text-body text-ink">{place.summary}</p>}

        <p className="mt-2 text-label text-muted">공공 인허가 데이터로 업력을 확인한 가게예요. 블로그 원문이나 타인의 사진은 싣지 않아요.</p>

        {hasInfo && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="운영 정보">
            {info.hours && <li className="rounded-lg bg-accent px-2.5 py-1 text-label font-bold text-on-accent">영업 {info.hours}</li>}
            {info.breakTime && (
              <li className="rounded-lg border border-line px-2.5 py-1 text-label font-bold text-ink">브레이크 {info.breakTime}</li>
            )}
            {info.closedDays.length > 0 && (
              <li className="rounded-lg border border-line px-2.5 py-1 text-label font-bold text-ink">
                정기휴무 {info.closedDays.join("·")}
              </li>
            )}
          </ul>
        )}

        <div className="mt-3 flex gap-2">
          <NavigationButton target={{ name: place.name, lat: place.lat, lng: place.lng, category: place.category }} />
        </div>

        {syncedLabel(place) && <p className="tnum mt-2 text-right text-caption text-muted">{syncedLabel(place)}</p>}
      </article>

      <Link
        href="/"
        className="theme-t mt-4 flex min-h-[48px] w-full items-center justify-center rounded-xl bg-primary px-4 text-label font-bold text-on-primary active:opacity-90"
      >
        지도에서 주변 노포 더 보기
      </Link>
      <p className="mt-3 text-center text-caption text-muted">Bravo My Life · 광고 없는 진짜 로컬 노포 가이드</p>
    </main>
  );
}
