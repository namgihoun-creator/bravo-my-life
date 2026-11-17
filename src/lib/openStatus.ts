import type { Place } from "@/data/places";

/**
 * '지금 영업 중 / 24시간' 판별 (Asia/Seoul 기준).
 *
 * 허위로 '영업 중'이라 표시하지 않는 것이 원칙이다:
 *  - true  : 24시간/연중무휴가 명시됐거나, 명시된 영업시간 구간 안에 현재 시각이 있음
 *  - false : 명시된 영업시간이 있고 지금은 구간 밖
 *  - null  : 영업시간 정보 없음(또는 평일 시간만 있는데 주말) → 모른다. 필터를 켜면 제외하고 '미확인'으로 안내한다.
 */
export interface OpenState {
  status: boolean | null;
  label: "24시간 운영 중" | "영업 중" | null;
}

const DASH = "(?:~|∼|-|–|—)";
// HH:MM~HH:MM / HH:MM - HH:MM
const RANGE_COLON = new RegExp(`(\\d{1,2}):(\\d{2})\\s*${DASH}\\s*(\\d{1,2}):(\\d{2})`);
// 9~18시 / #10~20시 (수집 데이터의 '평일 9~18시 운영' 형태)
const RANGE_HOUR = new RegExp(`(\\d{1,2})\\s*${DASH}\\s*(\\d{1,2})\\s*시`);
// 구간 표기를 지울 때 쓰는 패턴 ('#10~24시' 안의 '24시'를 24시간 운영으로 오인하지 않게)
const RANGE_ANY = new RegExp(`\\d{1,2}(?::\\d{2})?\\s*${DASH}\\s*\\d{1,2}(?::\\d{2})?\\s*시?`, "g");
// '24시 운영 여부는 확인하세요' 같은 확인 문구는 24시간 근거가 아니다
const UNCERTAIN_24 = /24\s*시\s*(?:간\s*)?(?:운영|영업)?\s*여부/g;
const ALWAYS_OPEN = /24\s*시|연중\s*무휴/;

const KST = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const DOW: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** 한국 시각의 (요일 0=월 … 6=일, 0시부터의 분) */
export function kstNow(ms: number): { dow: number; minutes: number } {
  const parts = KST.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return { dow: DOW[get("weekday")] ?? 0, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

interface Range {
  start: number; // 분
  end: number; // 분 (24:00 = 1440)
  weekdayOnly: boolean;
}

function parseRange(texts: { text: string; assumeWeekday: boolean }[]): Range | null {
  for (const { text, assumeWeekday } of texts) {
    for (const re of [RANGE_COLON, RANGE_HOUR]) {
      const m = re.exec(text);
      if (!m) continue;
      const colon = re === RANGE_COLON;
      const start = Number(m[1]) * 60 + (colon ? Number(m[2]) : 0);
      const end = colon ? Number(m[3]) * 60 + Number(m[4]) : Number(m[2]) * 60;
      if (start === end || start > 24 * 60 || end > 24 * 60) return null;
      const weekdayOnly = assumeWeekday || /평일\s*$/.test(text.slice(0, m.index));
      return { start, end, weekdayOnly };
    }
  }
  return null;
}

export function getOpenState(place: Place, nowMs: number): OpenState {
  const summary = place.summary ?? "";
  const extra = (place.extra ?? []).join(" ");
  const tags = (place.tags ?? []).join(" ");

  // 1) 24시간/연중무휴 — 구간 표기와 확인 문구를 지운 뒤 판별
  const corpus = `${tags} ${summary} ${extra} ${place.name}`.replace(RANGE_ANY, " ").replace(UNCERTAIN_24, " ");
  if (ALWAYS_OPEN.test(corpus)) return { status: true, label: "24시간 운영 중" };

  // 2) 명시된 영업시간 구간 (요약·extra 우선, 없으면 '#9~18시' 태그 = 평일 시간)
  const range = parseRange([
    { text: summary, assumeWeekday: false },
    { text: extra, assumeWeekday: false },
    { text: tags, assumeWeekday: true },
  ]);
  if (!range) return { status: null, label: null };

  const { dow, minutes } = kstNow(nowMs);
  if (range.weekdayOnly && dow >= 5) return { status: null, label: null }; // 주말 시간은 모른다

  const { start, end } = range;
  const open = start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end; // 자정 넘김
  return open ? { status: true, label: "영업 중" } : { status: false, label: null };
}
