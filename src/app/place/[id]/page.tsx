import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Award, ChevronRight, Phone, TriangleAlert, UtensilsCrossed } from "lucide-react";
import AddressLine from "@/components/AddressLine";
import CategoryIcon from "@/components/CategoryIcon";
import Footer from "@/components/Footer";
import ModeAttr from "@/components/ModeAttr";
import NavigationButton from "@/components/NavigationButton";
import PlaceHours from "@/components/PlaceHours";
import PlaceInfoLinks from "@/components/PlaceInfoLinks";
import PlaceIssueButton from "@/components/PlaceIssueButton";
import PlaceShareButton from "@/components/PlaceShareButton";
import { ageTier, fieldInfo, syncedLabel, walkMinutes, yearsInBusiness, type Place } from "@/data/places";
import { getIndexablePlaces, getNearbyNopo, getNearbyParking, getPlaceById, isIndexable } from "@/lib/placeServer";
import { foodParts, placeDescription, placeTitle, restaurantJsonLd } from "@/lib/placeSeo";
import { placeUrl } from "@/lib/site";
import { buildKakaoPlaceUrl, telHref } from "@/lib/navUrls";

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
  const tel = telHref(place.phone);
  const jsonLd = JSON.stringify(restaurantJsonLd(place)).replace(/</g, "\\u003c");

  return (
    <>
    <div className="mx-auto w-full max-w-md md:max-w-2xl">
    <main className="px-4 pb-4 pt-3">
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
            className={`mt-1.5 inline-flex max-w-full items-start gap-1 rounded-lg border border-warning px-2 py-1 text-label font-bold ${
              place.reported_issue === "closed" ? "bg-warning text-white" : "bg-surface text-warning"
            }`}
          >
            <TriangleAlert size={14} strokeWidth={2.25} className="mt-0.5 shrink-0" aria-hidden />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {place.reported_issue === "closed"
                ? "폐업 의심 · 방문 전 전화로 확인해 주세요"
                : "정보 변경 제보됨 · 방문 전 확인해 주세요"}
            </span>
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

        {place.tags.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="핵심 스펙">
            {place.tags.slice(0, 6).map((t) => (
              <li key={t} className="rounded-full bg-tag-bg px-2.5 py-1 text-caption font-medium text-tag-text">
                {t}
              </li>
            ))}
          </ul>
        )}

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

        <PlaceHours place={place} />

        <PlaceInfoLinks name={place.name} address={place.address} kakaoUrl={buildKakaoPlaceUrl(place.kakao_id)} />

        <div className="mt-3 flex gap-2">
          <NavigationButton target={{ name: place.name, lat: place.lat, lng: place.lng, category: place.category }} />
          {tel && (
            <a
              href={tel}
              aria-label={`${place.name}에 전화하기`}
              className="theme-t flex h-12 w-11 shrink-0 cursor-pointer flex-col items-center justify-center rounded-xl border border-line bg-surface text-ink active:opacity-80"
            >
              <Phone size={16} aria-hidden />
              <span className="text-caption font-semibold">전화</span>
            </a>
          )}
          <PlaceShareButton place={place} />
        </div>

        {syncedLabel(place) && <p className="tnum mt-2 text-right text-caption text-muted">{syncedLabel(place)}</p>}
      </article>

      <NearbyParkingBox lat={place.lat} lng={place.lng} />
      <NearbyNopoList id={place.id} lat={place.lat} lng={place.lng} />

      <PlaceIssueButton place={place} />

      <Link
        href="/"
        className="theme-t mt-5 flex min-h-[48px] w-full items-center justify-center rounded-xl bg-primary px-4 text-label font-bold text-on-primary active:opacity-90"
      >
        지도에서 주변 노포 더 보기
      </Link>
    </main>
    </div>
    <Footer />
    </>
  );
}

const distLabel = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`);

/** 도보권 공영주차장 1~2곳을 접지 않고 바로 보여 준다. 없으면 박스 자체를 그리지 않는다. */
async function NearbyParkingBox({ lat, lng }: { lat: number; lng: number }) {
  const list = await getNearbyParking(lat, lng);
  if (list.length === 0) return null;
  return (
    <section aria-label="주변 공영주차장" className="theme-t mt-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
      <h2 className="flex items-center gap-1.5 text-label font-bold text-ink">
        <CategoryIcon k="parking" size={16} />
        주변 공영주차장
      </h2>
      <ul className="mt-2 divide-y divide-line">
        {list.map((p) => (
          <li key={p.id} className="py-2 first:pt-0 last:pb-0">
            <p className="text-label font-semibold text-ink [overflow-wrap:anywhere]">{p.name}</p>
            <p className="tnum text-caption text-muted">
              도보 {walkMinutes(p.distanceM)}분 · {distLabel(p.distanceM)}
            </p>
            {/* 좁은 화면에서도 이름이 한 글자씩 꺾이지 않게 요금은 이름 아래 줄에 둔다 */}
            <span
              className={`mt-1 inline-block max-w-full rounded-lg px-2 py-0.5 text-caption font-bold [overflow-wrap:anywhere] ${
                p.fee === null ? "border border-line text-muted" : p.free ? "border border-success text-success" : "bg-accent text-on-accent"
              }`}
            >
              {p.fee === null ? "요금 정보 없음" : p.free ? p.fee : `요금 ${p.fee}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 반경 1km 이내 색인 가능한 다른 노포 최대 3곳(내부 링크). */
async function NearbyNopoList({ id, lat, lng }: { id: string; lat: number; lng: number }) {
  const list = await getNearbyNopo(id, lat, lng);
  if (list.length === 0) return null;
  return (
    <section aria-label="주변 다른 노포" className="mt-5">
      <h2 className="px-1 text-label font-bold text-ink">주변 다른 노포</h2>
      <ul className="mt-2 space-y-2">
        {list.map((n) => {
          const tier = n.years !== null ? ageTier(n.years) : null;
          return (
            <li key={n.id}>
              <Link
                href={`/place/${n.id}`}
                className="theme-t flex min-h-[56px] items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 active:opacity-80"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-label font-bold text-ink [overflow-wrap:anywhere]">{n.name}</p>
                  <p className="tnum text-caption text-muted">
                    {[n.food, distLabel(n.distanceM)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {tier && n.years !== null && (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-caption font-bold age-badge age-badge-${tier}`}>업력 {n.years}년</span>
                )}
                <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
