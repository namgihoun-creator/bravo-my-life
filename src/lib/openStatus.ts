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
  /** true: 블로그 스니펫에서 LLM이 추출한 추정값(`extra`의 `llm_hours:`)으로 판별. 카드에 '블로그 기준'을 표시하고 '지금 영업 중' 필터에서는 제외한다. */
  isLlm?: boolean;
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

interface FieldSource {
  closed_days?: unknown;
  break_time?: unknown;
  hours?: unknown;
}

/**
 * 정기휴무일(요일 배열) → 브레이크타임 → 영업시간 순으로 판별. 판별할 정보가 없으면 null.
 * feedback(데이터 파이프라인이 넣는 운영 정보)과 LLM 추정값(`llm_hours:`)이 같은 규칙을 쓴다.
 */
function stateFromFields(fb: FieldSource, nowMs: number): OpenState | null {
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

function fieldState(place: Place, nowMs: number): OpenState | null {
  return stateFromFields(place.feedback ?? {}, nowMs);
}

/* ───────────── LLM 추정 영업시간 (`extra`의 'llm_hours:{...}') ───────────── */

/** `extra`는 DB에서 text[] 라서 객체를 못 담는다 → 'llm_hours:' + JSON 문자열 한 줄로 저장한다(마이그레이션 불필요). */
export const LLM_HOURS_PREFIX = "llm_hours:";
const HM_STRICT = /^([01]?\d|2[0-4]):[0-5]\d~([01]?\d|2[0-4]):[0-5]\d$/;

/** 저장된 JSON을 엄격히 검증해 읽는다. 형식이 어긋나면 통째로 무시(null)해 잘못된 값이 영업 상태로 번지지 않게 한다. */
function readLlmHours(place: Place): FieldSource | null {
  const raw = (place.extra ?? []).find((e) => e.startsWith(LLM_HOURS_PREFIX));
  if (!raw) return null;
  try {
    const o = JSON.parse(raw.slice(LLM_HOURS_PREFIX.length)) as Record<string, unknown>;
    const hm = (v: unknown) => (typeof v === "string" && HM_STRICT.test(v) ? v : null);
    const days = Array.isArray(o.closed_days)
      ? [...new Set(o.closed_days.filter((d): d is string => (DAY_CHARS as readonly string[]).includes(d as string)))]
      : [];
    const hours = hm(o.hours);
    const break_time = hm(o.break_time);
    if (days.length >= 7) return null; // 매일 휴무는 비정상 → 버린다
    if (!hours && !break_time && days.length === 0) return null;
    return { hours, break_time, closed_days: days };
  } catch {
    return null;
  }
}

function llmState(place: Place, nowMs: number): OpenState | null {
  const src = readLlmHours(place);
  const st = src ? stateFromFields(src, nowMs) : null;
  return st ? { ...st, isLlm: true } : null;
}

/** 영업 상태. 우선순위: feedback 운영 정보 → 요약·extra·태그의 공식 표기 → LLM 추정(`isLlm: true`). 공식 정보가 있으면 추정값은 쓰지 않는다. */
export function getOpenState(place: Place, nowMs: number): OpenState {
  const field = fieldState(place, nowMs);
  if (field) return field;
  const official = officialState(place, nowMs);
  if (official.status !== null) return official;
  return llmState(place, nowMs) ?? official;
}

function officialState(place: Place, nowMs: number): OpenState {
  const summary = place.summary ?? "";
  // llm_hours 항목은 공식 표기가 아니므로 24시간·구간 판별에서 제외한다(추정값이 공식 값처럼 읽히지 않게)
  const extra = (place.extra ?? []).filter((e) => !e.startsWith(LLM_HOURS_PREFIX)).join(" ");
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
