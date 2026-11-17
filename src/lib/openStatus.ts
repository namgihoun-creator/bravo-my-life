import type { Place } from "@/data/places";

const DAY_CHARS = ["월", "화", "수", "목", "금", "토", "일"] as const; // places.ts의 DAY_CHARS와 동일(순수 모듈로 유지)

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
  /** 영업 중이 아닐 때의 사유 (현장 정보 기준): '오늘 정기휴무' | '브레이크타임 중' | '영업시간 외' */
  reason: string | null;
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

/** 'HH:MM~HH:MM' → 분 구간 */
function parseHM(range: unknown): { start: number; end: number } | null {
  if (typeof range !== "string") return null;
  const m = RANGE_COLON.exec(range);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  return start === end || start > 24 * 60 || end > 24 * 60 ? null : { start, end };
}

function inRange(minutes: number, { start, end }: { start: number; end: number }) {
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end; // 자정 넘김
}

/**
 * 현장에서 등록한 정보(feedback.closed_days / break_time / hours)로 판별. 있으면 summary 추정보다 우선한다.
 * 정기휴무일 → 브레이크타임 → 영업시간 순으로 본다. 판별할 정보가 없으면 null(요약 기반 판별로 넘어감).
 */
function fieldState(place: Place, nowMs: number): OpenState | null {
  const fb = place.feedback ?? {};
  const closed = Array.isArray(fb.closed_days) ? fb.closed_days : [];
  const brk = parseHM(fb.break_time);
  const hrs = parseHM(fb.hours);
  if (closed.length === 0 && !brk && !hrs) return null;

  const { dow, minutes } = kstNow(nowMs);
  if (closed.includes(DAY_CHARS[dow])) return { status: false, label: null, reason: "오늘 정기휴무" };
  if (brk && inRange(minutes, brk)) return { status: false, label: null, reason: "브레이크타임 중" };
  if (hrs) {
    return inRange(minutes, hrs)
      ? { status: true, label: "영업 중", reason: null }
      : { status: false, label: null, reason: "영업시간 외" };
  }
  return null; // 휴무일/브레이크만 있고 영업시간이 없으면 오늘 영업 여부는 모른다 → 요약 기반으로
}

export function getOpenState(place: Place, nowMs: number): OpenState {
  const field = fieldState(place, nowMs);
  if (field) return field;

  const summary = place.summary ?? "";
  const extra = (place.extra ?? []).join(" ");
  const tags = (place.tags ?? []).join(" ");

  // 1) 24시간/연중무휴 — 구간 표기와 확인 문구를 지운 뒤 판별
  const corpus = `${tags} ${summary} ${extra} ${place.name}`.replace(RANGE_ANY, " ").replace(UNCERTAIN_24, " ");
  if (ALWAYS_OPEN.test(corpus)) return { status: true, label: "24시간 운영 중", reason: null };

  // 2) 명시된 영업시간 구간 (요약·extra 우선, 없으면 '#9~18시' 태그 = 평일 시간)
  const range = parseRange([
    { text: summary, assumeWeekday: false },
    { text: extra, assumeWeekday: false },
    { text: tags, assumeWeekday: true },
  ]);
  if (!range) return { status: null, label: null, reason: null };

  const { dow, minutes } = kstNow(nowMs);
  if (range.weekdayOnly && dow >= 5) return { status: null, label: null, reason: null }; // 주말 시간은 모른다

  const { start, end } = range;
  const open = start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end; // 자정 넘김
  return open ? { status: true, label: "영업 중", reason: null } : { status: false, label: null, reason: null };
}
