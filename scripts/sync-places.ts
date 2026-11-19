/**
 * 데이터 현행화 스크립트 (GitHub Actions 가 주기적으로 실행, 로컬에서도 실행 가능).
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/sync-places.ts --mode=survival [--dry-run] [--hubs=부천역,수원역]
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/sync-places.ts --mode=nopo-check [--dry-run] [--limit=50]
 *
 * 원칙
 *  - 장소 행은 절대 DELETE 하지 않는다(커플 찜·다녀옴·현장 제보가 bml_places.id 를 참조한다). 숨기는 것은 is_active=false 로만 한다.
 *  - survival : 36개 거점 반경에서 카카오 로컬로 코인세탁·프린트·약국·셀프세차를 다시 조회해 source_key 기준으로
 *               기존 행은 좌표·주소·요약·last_synced_at 만 UPDATE, 신규는 INSERT. 이번에 안 보인 기존 행은 '미검출'로 세기만 한다
 *               (카카오 검색은 키워드당 45건 한도라 미검출이 곧 폐업은 아니므로 자동으로 숨기지 않는다).
 *  - nopo-check: 검증된 노포를 상호+좌표 반경으로 카카오와 대조해, 안 보이면 삭제 대신 reported_issue='closed'(폐업 의심 플래그)만 건다.
 *  - --dry-run : DB 에 쓰지 않고 갱신·신규·미검출 건수만 리포트한다.
 *  - 006_data_freshness.sql 적용 전에는 --dry-run 만 가능하다(쓰기는 안내 후 중단).
 *
 * 환경변수: SUPABASE_URL(없으면 NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, KAKAO_REST_API_KEY
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HUBS } from "../src/data/places.ts";

try {
  process.loadEnvFile(".env.local"); // 로컬 실행용. Actions 에서는 Secrets 가 환경변수로 들어온다.
} catch {
  /* 파일이 없으면 이미 주입된 환경변수를 쓴다 */
}

/* ───────────── 설정 ───────────── */

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;
const KAKAO_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const RADIUS_M = 2000;
const MAX_PAGES = 3;

type Category = "laundry" | "print" | "pharmacy" | "carwash";

interface CategoryConfig {
  queries: string[];
  /** 검색어와 무관한 업종 제거용: 상호 또는 카카오 분류에 이 중 하나가 있어야 한다 */
  must: string[];
  tags: string[];
  badge: string;
  summary: string;
}

const CATEGORIES: Record<Category, CategoryConfig> = {
  laundry: {
    queries: ["24시 코인세탁소", "코인빨래방", "크린토피아 코인워시", "워시엔조이", "셀프빨래방"],
    must: ["세탁", "빨래", "워시", "크린토피아"],
    tags: ["#코인세탁", "#셀프빨래방", "#결제수단확인"],
    badge: "코인세탁",
    summary: "근처 코인세탁소 후보예요. 24시 운영 여부와 결제 수단은 방문 전 확인해 주세요.",
  },
  print: {
    queries: ["무인프린트", "무인 프린트", "셀프 프린트", "프린트카페", "무인복사", "24시 인쇄"],
    must: ["프린트", "복사", "인쇄", "출력"],
    tags: ["#무인프린트", "#셀프출력", "#용지재고확인"],
    badge: "무인",
    summary: "무인프린트 후보예요. 용지 재고와 출력 가능 사이즈는 현장 후기를 참고하세요.",
  },
  pharmacy: {
    queries: ["심야약국", "24시 약국", "공공심야약국", "365약국", "연중무휴 약국"],
    must: ["약국"],
    tags: ["#약국", "#심야영업확인", "#전화문의권장"],
    badge: "심야 확인",
    summary: "약국 후보예요. 심야 영업 시간은 전화나 지도 앱에서 한 번 더 확인하세요.",
  },
  carwash: {
    queries: ["셀프세차장", "셀프세차", "무인세차", "코인세차"],
    must: ["세차"],
    tags: ["#세차장", "#운영시간확인", "#휴무일확인"],
    badge: "세차",
    summary: "세차장이에요. 운영시간은 방문 전 전화로 확인하세요.",
  },
};
const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];
const KNOWN_SUMMARIES = new Set(Object.values(CATEGORIES).map((c) => c.summary));

/* ───────────── 타입·유틸 ───────────── */

interface KakaoDoc {
  id: string;
  place_name: string;
  category_name?: string;
  address_name?: string;
  road_address_name?: string;
  phone?: string;
  place_url?: string;
  x: string;
  y: string;
}

interface KakaoBody {
  documents?: KakaoDoc[];
  meta?: { is_end?: boolean };
}

interface Row {
  id: string;
  kakao_id: string | null;
  source_key: string | null;
  category: string;
  name: string;
  address: string | null;
  summary: string;
  lat: number;
  lng: number;
  source: string;
  open_year?: number | null;
  reported_issue?: string | null;
  closure_reports?: number | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const p = Math.PI / 180;
  const x =
    Math.sin(((bLat - aLat) * p) / 2) ** 2 +
    Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(((bLng - aLng) * p) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(x));
}

/** DB 의 kakao_id 로 source_key 를 만든다 (006 마이그레이션 백필과 같은 규칙) */
function deriveKey(kakaoId: string | null): string | null {
  if (!kakaoId) return null;
  return /^[0-9]+$/.test(kakaoId) ? `kakao_${kakaoId}` : kakaoId.replace(/[^A-Za-z0-9]+/g, "_");
}

const normName = (s: string) => s.replace(/[\s()·\-_.,]/g, "").toLowerCase();
const sameName = (a: string, b: string) => {
  const x = normName(a);
  const y = normName(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

async function kakaoSearch(
  query: string,
  lat: number,
  lng: number,
  opts: { radius?: number; group?: string; pages?: number } = {},
): Promise<KakaoDoc[]> {
  const out: KakaoDoc[] = [];
  for (let page = 1; page <= (opts.pages ?? MAX_PAGES); page++) {
    const params = new URLSearchParams({
      query,
      x: String(lng),
      y: String(lat),
      radius: String(opts.radius ?? RADIUS_M),
      size: "15",
      page: String(page),
      sort: "distance",
    });
    if (opts.group) params.set("category_group_code", opts.group);
    let body: KakaoBody | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${KAKAO_URL}?${params}`, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
      if (res.status === 429) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        console.error(`  ! Kakao ${res.status}: ${(await res.text()).slice(0, 120)}`);
        return out;
      }
      body = (await res.json()) as KakaoBody;
      break;
    }
    if (!body) return out;
    out.push(...(body.documents ?? []));
    if (body.meta?.is_end !== false) break;
    await sleep(80);
  }
  return out;
}

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
}

const chunk = <T>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** 새 컬럼(006)이 이미 적용돼 있는지 확인한다 */
async function hasFreshnessColumns(sb: SupabaseClient): Promise<boolean> {
  const { error } = await sb
    .from("bml_places")
    .select("source_key,is_active,last_synced_at,reported_issue,closure_reports")
    .limit(1);
  return !error;
}

/* ───────────── survival ───────────── */

async function syncSurvival(sb: SupabaseClient, dryRun: boolean, hubNames: string[] | null, migrated: boolean) {
  const hubs = HUBS.filter((h) => !hubNames || hubNames.includes(h.name));
  if (hubs.length === 0) throw new Error("알 수 없는 거점입니다.");
  const full = hubs.length === HUBS.length;

  const survivalCols: string = migrated
    ? "id,kakao_id,source_key,category,name,address,summary,lat,lng,source"
    : "id,kakao_id,category,name,address,summary,lat,lng,source";
  const existing = await fetchAll<Row>((from, to) =>
    sb
      .from("bml_places")
      // 006 적용 전에는 source_key 컬럼이 없어 kakao_id 로 키를 만든다(dry-run 전용)
      .select(survivalCols)
      .eq("mode", "survival")
      .in("category", CATEGORY_KEYS)
      .range(from, to),
  );
  const byKey = new Map<string, Row>();
  for (const r of existing) {
    const k = r.source_key ?? deriveKey(r.kakao_id);
    if (k) byKey.set(k, r);
  }
  console.log(`기존 행 ${existing.length}곳 (코인세탁·프린트·약국·세차장), 거점 ${hubs.length}곳 조회 시작`);

  // 1) 카카오 재조회
  const seen = new Map<string, { doc: KakaoDoc; category: Category }>();
  for (const hub of hubs) {
    let n = 0;
    for (const cat of CATEGORY_KEYS) {
      for (const q of CATEGORIES[cat].queries) {
        for (const d of await kakaoSearch(q, hub.lat, hub.lng)) {
          const key = `kakao_${d.id}`;
          if (seen.has(key)) continue;
          const hay = `${d.place_name} ${d.category_name ?? ""}`;
          if (!CATEGORIES[cat].must.some((m) => hay.includes(m))) continue;
          seen.set(key, { doc: d, category: cat });
          n++;
        }
      }
    }
    console.log(`  [${hub.name}] 조회 ${n}곳 (누적 ${seen.size})`);
  }

  // 2) 비교: 갱신 / 재확인 / 신규 / 중복(다른 출처의 같은 가게)
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const touch: string[] = [];
  const inserts: Record<string, unknown>[] = [];
  let merged = 0;
  const now = new Date().toISOString();
  const byCategory = new Map<Category, Row[]>();
  for (const r of existing) {
    const list = byCategory.get(r.category as Category) ?? [];
    list.push(r);
    byCategory.set(r.category as Category, list);
  }

  for (const [key, { doc, category }] of seen) {
    const lat = Number(doc.y);
    const lng = Number(doc.x);
    const address = doc.road_address_name || doc.address_name || null;
    const cfg = CATEGORIES[category];
    const row = byKey.get(key);
    if (row) {
      const patch: Record<string, unknown> = {};
      if (haversine(row.lat, row.lng, lat, lng) > 5) {
        patch.lat = lat;
        patch.lng = lng;
      }
      if (address && address !== row.address) patch.address = address;
      // 요약은 수집 기본 문구일 때만 바꾼다(공공데이터로 보강한 요약은 보존)
      if (!row.summary || (KNOWN_SUMMARIES.has(row.summary) && row.summary !== cfg.summary)) patch.summary = cfg.summary;
      if (Object.keys(patch).length) updates.push({ id: row.id, patch });
      else touch.push(row.id);
      continue;
    }
    // 같은 카테고리에서 40m 안·상호가 겹치는 기존 행(다른 출처)이 있으면 새로 만들지 않는다
    const dup = (byCategory.get(category) ?? []).find(
      (r) => Math.abs(r.lat - lat) < 0.0005 && Math.abs(r.lng - lng) < 0.0007 && haversine(r.lat, r.lng, lat, lng) <= 40 && sameName(r.name, doc.place_name),
    );
    if (dup) {
      merged++;
      touch.push(dup.id);
      continue;
    }
    inserts.push({
      kakao_id: doc.id,
      source_key: key,
      mode: "survival",
      category,
      extra: category === "carwash" ? [`type:${doc.place_name.includes("셀프") ? "셀프세차" : "세차장"}`] : [],
      name: doc.place_name,
      address,
      phone: doc.phone || null,
      place_url: doc.place_url ?? null,
      badge: cfg.badge,
      tags: cfg.tags,
      summary: cfg.summary,
      lat,
      lng,
      source: "kakao",
      last_synced_at: now,
    });
  }

  // 이번에 안 보인 카카오 출처 기존 행 (전체 거점을 돌렸을 때만 의미가 있다)
  const undetected = full
    ? existing.filter((r) => {
        const k = r.source_key ?? deriveKey(r.kakao_id);
        return !!k && k.startsWith("kakao_") && !seen.has(k);
      })
    : [];

  console.log("\n── survival 리포트 ──");
  console.log(`카카오 조회 ${seen.size}곳`);
  console.log(`갱신(좌표·주소·요약 변경) ${updates.length}곳`);
  console.log(`재확인(변경 없음, last_synced_at 만) ${touch.length}곳`);
  console.log(`신규 ${inserts.length}곳 (다른 출처와 중복이라 병합 ${merged}곳)`);
  console.log(full ? `미검출 ${undetected.length}곳 (자동으로 숨기지 않음 — 수동 확인 대상)` : "미검출: 일부 거점만 조회해 집계하지 않음");
  for (const u of updates.slice(0, 3)) console.log("  갱신 예)", u.id, JSON.stringify(u.patch));
  for (const i of inserts.slice(0, 3)) console.log("  신규 예)", i.name, i.category, i.address);
  for (const r of undetected.slice(0, 3)) console.log("  미검출 예)", r.name, r.category);

  if (dryRun) {
    console.log("\n--dry-run: DB 에 쓰지 않았습니다.");
    return;
  }

  for (const u of updates) {
    const { error } = await sb.from("bml_places").update({ ...u.patch, last_synced_at: now }).eq("id", u.id);
    if (error) throw new Error(`update ${u.id}: ${error.message}`);
  }
  for (const ids of chunk(touch, 100)) {
    const { error } = await sb.from("bml_places").update({ last_synced_at: now }).in("id", ids);
    if (error) throw new Error(`touch: ${error.message}`);
  }
  for (const rows of chunk(inserts, 200)) {
    const { error } = await sb.from("bml_places").upsert(rows, { onConflict: "kakao_id", ignoreDuplicates: true });
    if (error) throw new Error(`insert: ${error.message}`);
  }
  console.log("\n완료: DB 반영");
}

/* ───────────── nopo-check ───────────── */

/**
 * 미검출 비율 가드. 정상 상태의 미검출은 0.1% 안팎(2026-11 dry-run: 1,572곳 중 1곳)이라 3%면 충분히 이상 신호다.
 * 초과하면 카카오 장애·검색 변경 등으로 오탐이 쏟아진 것으로 보고 DB 에 아무것도 쓰지 않고 실패(exit 1)한다.
 * 워크플로가 scripts/out/anomaly.md 를 읽어 GitHub Issue 를 만든다(열린 Issue 가 있으면 코멘트만).
 * NOPO_MISSING_MAX_PCT 로 조정, 표본이 너무 작으면(--limit 등) 판정하지 않는다.
 */
const MISSING_MAX_PCT = Number(process.env.NOPO_MISSING_MAX_PCT ?? 3);
const GUARD_MIN_ROWS = 50;
const ANOMALY_FILE = "scripts/out/anomaly.md";

function writeStepSummary(md: string) {
  const f = process.env.GITHUB_STEP_SUMMARY; // Actions 실행 요약 탭 (로컬에서는 없음)
  if (f) appendFileSync(f, md + "\n");
}

async function checkNopo(sb: SupabaseClient, dryRun: boolean, limit: number | null, migrated: boolean) {
  const nopoCols: string = migrated
    ? "id,kakao_id,source_key,category,name,address,summary,lat,lng,source,open_year,reported_issue,closure_reports"
    : "id,kakao_id,category,name,address,summary,lat,lng,source,open_year";
  let rows = await fetchAll<Row>((from, to) =>
    sb
      .from("bml_places")
      .select(nopoCols)
      .eq("mode", "nopo")
      .eq("source", "kakao")
      .not("open_year", "is", null) // 화면에 노출되는 검증된 노포만 점검
      .range(from, to),
  );
  if (limit) rows = rows.slice(0, limit);
  console.log(`점검 대상 노포 ${rows.length}곳 (검증된 노포, 상호+좌표 반경 150m로 카카오와 대조)`);

  const found: Row[] = [];
  const missing: Row[] = [];
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= rows.length) return;
      const r = rows[i];
      const docs = await kakaoSearch(r.name, r.lat, r.lng, { radius: 150, pages: 1 });
      const ok = docs.some((d) => d.id === r.kakao_id || sameName(d.place_name, r.name));
      (ok ? found : missing).push(r);
      if ((found.length + missing.length) % 200 === 0) console.log(`  진행 ${found.length + missing.length}/${rows.length}`);
      await sleep(40);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  const newFlags = missing.filter((r) => !r.reported_issue);
  const alreadyFlagged = missing.length - newFlags.length;
  // 이전 점검이 건 '폐업 의심'(제보 0건)이 이번에 다시 검색되면 플래그를 푼다
  const cleared = found.filter((r) => r.reported_issue === "closed" && (r.closure_reports ?? 0) === 0);

  console.log("\n── nopo-check 리포트 ──");
  console.log(`카카오에서 확인 ${found.length}곳`);
  console.log(`미검출 ${missing.length}곳 → 신규 폐업 의심 플래그 ${newFlags.length}곳 (이미 제보·플래그된 ${alreadyFlagged}곳은 그대로)`);
  console.log(`이전 의심 플래그 해제 ${cleared.length}곳`);
  for (const r of newFlags.slice(0, 5)) console.log("  의심 예)", r.name, r.address ?? "");

  const pct = rows.length ? (missing.length / rows.length) * 100 : 0;
  const mode = dryRun ? "dry-run" : "쓰기";
  const head = `미검출 ${missing.length}/${rows.length}곳 (${pct.toFixed(2)}%), 임계 ${MISSING_MAX_PCT}%`;
  if (rows.length >= GUARD_MIN_ROWS && pct > MISSING_MAX_PCT) {
    const examples = missing.slice(0, 10).map((r) => `- ${r.name} (${r.address ?? "주소 없음"})`).join("\n");
    const body = [
      `### nopo-check 이상 감지 (${mode})`,
      `${head} → **DB 에 아무것도 쓰지 않고 중단했습니다.**`,
      "",
      "카카오 API 장애·응답 변경·키 문제로 검색이 비었을 가능성이 큽니다. 원인을 확인한 뒤 수동 실행(`workflow_dispatch`)으로 다시 돌려 주세요.",
      "",
      "미검출 예시(최대 10곳):",
      examples,
    ].join("\n");
    mkdirSync("scripts/out", { recursive: true });
    writeFileSync(ANOMALY_FILE, body + "\n");
    writeStepSummary(body);
    console.error(`
⚠ ${head} — 임계 초과: 쓰기 중단 (${ANOMALY_FILE} 기록)`);
    process.exit(1);
  }
  writeStepSummary(
    [
      `### nopo-check 결과 (${mode})`,
      `- 확인 ${found.length}곳 / ${head}`,
      `- 신규 폐업 의심 ${newFlags.length}곳, 의심 해제 ${cleared.length}곳`,
    ].join("\n"),
  );

  if (dryRun) {
    console.log("\n--dry-run: DB 에 쓰지 않았습니다.");
    return;
  }
  const now = new Date().toISOString();
  for (const ids of chunk(found.map((r) => r.id), 100)) {
    const { error } = await sb.from("bml_places").update({ last_synced_at: now }).in("id", ids);
    if (error) throw new Error(`touch: ${error.message}`);
  }
  for (const ids of chunk(newFlags.map((r) => r.id), 100)) {
    const { error } = await sb.from("bml_places").update({ reported_issue: "closed" }).in("id", ids).is("reported_issue", null);
    if (error) throw new Error(`flag: ${error.message}`);
  }
  for (const ids of chunk(cleared.map((r) => r.id), 100)) {
    const { error } = await sb.from("bml_places").update({ reported_issue: null }).in("id", ids).eq("closure_reports", 0);
    if (error) throw new Error(`unflag: ${error.message}`);
  }
  console.log("\n완료: DB 반영");
}

/* ───────────── main ───────────── */

async function main() {
  const args = new Map(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? "true"] as const;
    }),
  );
  const mode = args.get("mode");
  const dryRun = args.has("dry-run");
  if (mode !== "survival" && mode !== "nopo-check") {
    console.error("사용법: --mode=survival|nopo-check [--dry-run] [--hubs=부천역,수원역] [--limit=N]");
    process.exit(1);
  }
  if (!SUPABASE_URL || !SERVICE_KEY || !KAKAO_KEY) {
    console.error("환경변수가 필요합니다: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, KAKAO_REST_API_KEY");
    process.exit(1);
  }
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const migrated = await hasFreshnessColumns(sb);
  if (!migrated) {
    console.warn("⚠ 006_data_freshness.sql 이 아직 적용되지 않았습니다.");
    if (!dryRun) {
      console.error("쓰기 모드는 마이그레이션 적용 후에만 실행할 수 있습니다. (--dry-run 은 가능)");
      process.exit(1);
    }
  }

  console.log(`mode=${mode}${dryRun ? " (dry-run)" : ""}\n`);
  if (mode === "survival") {
    const hubs = args.get("hubs");
    await syncSurvival(sb, dryRun, hubs ? hubs.split(",") : null, migrated);
  } else {
    const limit = Number(args.get("limit"));
    await checkNopo(sb, dryRun, Number.isFinite(limit) && limit > 0 ? limit : null, migrated);
  }
}

main().catch((e) => {
  console.error("실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
