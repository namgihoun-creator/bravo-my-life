/**
 * 커플 공유 코드: 회원가입 없이 4~8자리 코드만으로 두 스마트폰의 '찜'·'다녀옴(한 줄 메모)'을 맞춘다.
 *  - 코드가 없으면 기존처럼 localStorage 만 쓴다(src/lib/favorites.ts, visited.ts).
 *  - 코드를 처음 연결하면 기기의 찜·다녀옴과 그 코드의 서버 데이터를 합친다(합집합: 한쪽에만 있는 건 양쪽에 생긴다).
 *  - 연결 뒤에는 변경마다 Supabase `bml_couple_places` 에 upsert 하고, Realtime(postgres_changes)과
 *    앱 복귀(visibilitychange)·온라인 복귀 때의 재동기화로 상대 기기의 변경을 반영한다. 서버 반영이 실패하면
 *    pending 에 쌓았다가 다음 동기화 때 먼저 보낸다.
 *  - 서버에는 장소 id·찜 여부·다녀옴 여부·60자 메모만 저장한다. 상대 기기에 없는 장소는 bml_places 에서 id 로 불러온다.
 * ⚠ 로그인이 없으므로 코드를 아는 사람은 그 코드의 데이터를 읽고 쓸 수 있다(supabase/migrations/005 참고).
 */
import { useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Place } from "@/data/places";
import { getFavorites, setFavorite } from "@/lib/favorites";
import { getSupabase } from "@/lib/supabase";
import { showToast } from "@/lib/toast";
import { cleanNote, getVisited, removeVisited, setVisited } from "@/lib/visited";

const CODE_KEY = "bml_couple_code";
const PENDING_KEY = "bml_couple_pending";
const TABLE = "bml_couple_places";
const PLACE_COLS = "id,mode,category,extra,name,address,place_url,badge,tags,summary,lat,lng,feedback,open_year";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CODE_RE = /^[A-Z0-9]{4,8}$/;
export const normalizeCode = (s: string) => s.toUpperCase().replace(/\s+/g, "");

/** 헷갈리는 글자(0/O, 1/I)를 뺀 6자리 코드 */
export function generateCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

interface Row {
  place_id: string;
  is_favorite: boolean;
  is_visited: boolean;
  visited_note: string | null;
}
type Patch = Partial<Pick<Row, "is_favorite" | "is_visited" | "visited_note">>;
type Pending = Record<string, Patch>;

export interface CoupleState {
  /** 연결된 코드 (null = 연결 안 됨) */
  code: string | null;
  /** 동기화 중 */
  busy: boolean;
}

const SERVER_STATE: CoupleState = { code: null, busy: false };
let state: CoupleState = SERVER_STATE;
let started = false;
let syncing = false;
let channel: RealtimeChannel | null = null;
let warnedAt = 0;
const listeners = new Set<() => void>();
/** 서버로 보내는 변경과 서버에서 받은 변경은 각각 도착 순서대로 한 줄로 처리한다.
 *  (체크인 직후 메모 저장처럼 연달아 오는 이벤트가 서로를 덮어쓰지 않게 한다) */
let pushChain: Promise<unknown> = Promise.resolve();
let applyChain: Promise<unknown> = Promise.resolve();
const enqueueApply = (rows: Row[], initial: boolean) => {
  applyChain = applyChain.then(() => applyRows(rows, initial)).catch((e) => console.error("couple apply", e));
  return applyChain;
};

function set(next: CoupleState) {
  if (next.code === state.code && next.busy === state.busy) return;
  state = next;
  listeners.forEach((l) => l());
}

function readCode(): string | null {
  try {
    const c = localStorage.getItem(CODE_KEY);
    return c && CODE_RE.test(c) ? c : null;
  } catch {
    return null;
  }
}

function readPending(): Pending {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const p = raw ? JSON.parse(raw) : {};
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Pending) : {};
  } catch {
    return {};
  }
}

function writePending(p: Pending) {
  try {
    if (Object.keys(p).length === 0) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* 저장 불가: 이번 세션에서는 pending 없이 진행 */
  }
}

function addPending(id: string, patch: Patch) {
  const p = readPending();
  p[id] = { ...p[id], ...patch };
  writePending(p);
}

function warnOnce() {
  if (Date.now() - warnedAt < 60_000) return;
  warnedAt = Date.now();
  showToast("연결이 불안정해요. 연결되면 자동으로 맞춰져요.");
}

/* ───────────── 서버 I/O ───────────── */

async function fetchPlaces(ids: string[]): Promise<Map<string, Place>> {
  const out = new Map<string, Place>();
  const valid = ids.filter((id) => UUID_RE.test(id));
  const sb = getSupabase();
  for (let i = 0; i < valid.length; i += 80) {
    const { data, error } = await sb.from("bml_places").select(PLACE_COLS).in("id", valid.slice(i, i + 80));
    if (error) throw error;
    for (const r of (data ?? []) as Omit<Place, "distance_m">[]) out.set(r.id, { ...r, distance_m: 0 });
  }
  return out;
}

async function upsertRows(code: string, rows: ({ place_id: string } & Patch)[]) {
  if (rows.length === 0) return;
  const payload = rows.map((r) => ({ couple_code: code, ...r }));
  for (let i = 0; i < payload.length; i += 100) {
    const { error } = await getSupabase()
      .from(TABLE)
      .upsert(payload.slice(i, i + 100), { onConflict: "couple_code,place_id" });
    if (error) throw error;
  }
}

/** 서버 행을 기기에 반영한다. initial(첫 연결)이면 합집합이라 '꺼짐'으로는 지우지 않는다. */
async function applyRows(rows: Row[], initial: boolean) {
  const favs = getFavorites();
  const vis = getVisited();
  const need = new Set<string>();
  for (const r of rows) {
    if (r.is_favorite && !favs[r.place_id]) need.add(r.place_id);
    if (r.is_visited && !vis[r.place_id]) need.add(r.place_id);
  }
  const fetched = need.size ? await fetchPlaces([...need]) : new Map<string, Place>();

  for (const r of rows) {
    if (r.is_favorite) {
      const p = favs[r.place_id] ?? fetched.get(r.place_id);
      if (p) setFavorite(p, true);
    } else if (!initial && favs[r.place_id]) {
      setFavorite(favs[r.place_id], false);
    }
    if (r.is_visited) {
      const p = vis[r.place_id]?.place ?? fetched.get(r.place_id);
      if (p) setVisited(p, r.visited_note);
    } else if (!initial && vis[r.place_id]) {
      removeVisited(r.place_id);
    }
  }
}

/** 보내지 못한 변경 → 기기 ↔ 서버 비교 → 서버 반영. 성공하면 true. */
async function sync(code: string, initial: boolean): Promise<boolean> {
  if (syncing) return true;
  syncing = true;
  set({ ...state, busy: true });
  try {
    const pending = readPending();
    const pendingIds = Object.keys(pending);
    if (pendingIds.length) {
      await upsertRows(code, pendingIds.map((id) => ({ place_id: id, ...pending[id] })));
      writePending({});
    }

    const { data, error } = await getSupabase()
      .from(TABLE)
      .select("place_id,is_favorite,is_visited,visited_note")
      .eq("couple_code", code);
    if (error) throw error;
    const map = new Map<string, Row>();
    for (const r of (data ?? []) as Row[]) map.set(r.place_id, r);

    // 서버에 없거나(initial 이면 꺼져 있거나 메모가 비어 있는) 기기 쪽 값은 서버로 올린다
    const up: ({ place_id: string } & Patch)[] = [];
    const patchOf = (id: string): Row => {
      let r = map.get(id);
      if (!r) {
        r = { place_id: id, is_favorite: false, is_visited: false, visited_note: null };
        map.set(id, r);
      }
      return r;
    };
    for (const id of Object.keys(getFavorites())) {
      const known = map.get(id);
      if (!known || (initial && !known.is_favorite)) {
        patchOf(id).is_favorite = true;
        up.push({ place_id: id, is_favorite: true });
      }
    }
    for (const [id, v] of Object.entries(getVisited())) {
      const known = map.get(id);
      if (!known || (initial && (!known.is_visited || (!known.visited_note && v.note)))) {
        const r = patchOf(id);
        r.is_visited = true;
        r.visited_note = known?.visited_note ?? v.note;
        up.push({ place_id: id, is_visited: true, visited_note: r.visited_note });
      }
    }
    await upsertRows(code, up);
    await enqueueApply([...map.values()], initial);
    return true;
  } catch (e) {
    console.error("couple sync", e);
    return false;
  } finally {
    syncing = false;
    set({ ...state, busy: false });
  }
}

function listen(code: string) {
  stopListening();
  try {
    channel = getSupabase()
      .channel(`bml-couple-${code}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLE, filter: `couple_code=eq.${code}` },
        (payload) => {
          const row = payload.new as Partial<Row>;
          if (!row?.place_id) return;
          void enqueueApply(
            [
              {
                place_id: row.place_id,
                is_favorite: !!row.is_favorite,
                is_visited: !!row.is_visited,
                visited_note: row.visited_note ?? null,
              },
            ],
            false,
          );
        },
      )
      .subscribe();
  } catch (e) {
    console.error("couple realtime", e);
  }
}

function stopListening() {
  if (!channel) return;
  try {
    getSupabase().removeChannel(channel);
  } catch {
    /* 이미 정리됨 */
  }
  channel = null;
}

/* ───────────── 공개 API ───────────── */

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const code = readCode();
  set({ code, busy: false });
  if (code) {
    void sync(code, false);
    listen(code);
  }
  const resync = () => {
    if (state.code && document.visibilityState !== "hidden" && navigator.onLine !== false) void sync(state.code, false);
  };
  document.addEventListener("visibilitychange", resync);
  window.addEventListener("online", resync);
}

function subscribe(cb: () => void) {
  start();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useCouple(): CoupleState {
  return useSyncExternalStore(
    subscribe,
    () => {
      start();
      return state;
    },
    () => SERVER_STATE,
  );
}

/** 코드를 연결한다. 서버에 닿지 않으면(오프라인·테이블 미생성) 연결하지 않고 false. */
export async function connectCouple(raw: string): Promise<{ ok: boolean; reason?: "format" | "network" }> {
  const code = normalizeCode(raw);
  if (!CODE_RE.test(code)) return { ok: false, reason: "format" };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, reason: "network" };
  if (state.code === code) return { ok: true };
  for (let i = 0; syncing && i < 50; i++) await new Promise((r) => setTimeout(r, 100)); // 진행 중인 동기화가 끝나길 잠깐 기다린다
  if (!(await sync(code, true))) return { ok: false, reason: "network" };
  try {
    localStorage.setItem(CODE_KEY, code);
  } catch {
    /* 저장 불가: 이번 세션에서만 연결 */
  }
  writePending({});
  set({ ...state, code });
  listen(code);
  return { ok: true };
}

/** 연동 해제: 동기화만 멈춘다. 기기의 찜·다녀옴은 그대로 남고, 서버 데이터도 지우지 않는다. */
export function disconnectCouple() {
  stopListening();
  try {
    localStorage.removeItem(CODE_KEY);
  } catch {
    /* 무시 */
  }
  writePending({});
  set({ code: null, busy: false });
}

function push(id: string, patch: Patch) {
  const code = state.code;
  if (!code) return Promise.resolve();
  pushChain = pushChain.then(async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("offline");
      await upsertRows(code, [{ place_id: id, ...patch }]);
    } catch (e) {
      console.error("couple push", e);
      addPending(id, patch);
      warnOnce();
    }
  });
  return pushChain;
}

/** 찜을 켜거나 껐을 때 호출(연결 안 됐으면 아무 일도 안 한다) */
export function pushFavorite(placeId: string, on: boolean) {
  return push(placeId, { is_favorite: on });
}

/** 다녀옴 체크인/해제·메모 변경 때 호출 */
export function pushVisited(placeId: string, visited: boolean, note: string | null) {
  return push(placeId, { is_visited: visited, visited_note: visited ? cleanNote(note) : null });
}
