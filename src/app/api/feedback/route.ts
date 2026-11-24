import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { clean, clientIp, createRateLimiter, isSameOrigin } from "@/lib/apiGuard";

/**
 * POST /api/feedback — '앱 의견 보내기'(좋아요/불편해요/아이디어 + 한 줄)
 * 로그인이 없어 서버에서만 service role 키로 insert 한다(테이블은 RLS 로 anon 전면 차단).
 * 남용 방지: 동일 출처 확인, 허니팟, IP당 시간당 5건(서버리스에서는 best-effort), 길이·링크·연락처 차단.
 * IP·기기 정보는 저장하지 않는다(횟수 제한에만 서버 메모리에서 쓴다).
 */

const rateLimited = createRateLimiter(5);
const KINDS = new Set(["like", "pain", "idea"]);
const SPAM = /https?:|www\.|[a-z0-9-]+\.(com|net|kr|io|me|co)\b|@|카톡|오픈채팅|텔레그램|\d{2,4}[-\s.]?\d{3,4}[-\s.]?\d{4}/i;

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "허용되지 않은 요청이에요." }, { status: 403 });
  }
  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "의견은 1시간에 5건까지 보낼 수 있어요. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "서버 설정이 완료되지 않았어요." }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  // 허니팟: 사람은 채우지 않는 필드. 봇이면 성공한 척하고 저장하지 않는다.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const kind = typeof body.kind === "string" ? body.kind : "";
  const message = clean(body.message, 140);
  if (!KINDS.has(kind)) return NextResponse.json({ error: "의견 종류를 골라 주세요." }, { status: 400 });
  if (message.length < 2) return NextResponse.json({ error: "의견을 두 글자 이상 적어 주세요." }, { status: 400 });
  if (SPAM.test(message)) {
    return NextResponse.json({ error: "링크·연락처는 받지 않아요. 내용만 적어 주세요." }, { status: 400 });
  }
  const mode = body.mode === "survival" || body.mode === "nopo" ? body.mode : null;
  const rawPath = clean(body.path, 80);
  const path = rawPath.startsWith("/") ? rawPath : null;

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await supabase.from("bml_app_feedback").insert({ kind, message, mode, path });
  if (error) {
    console.error("app feedback insert", error.code, error.message);
    return NextResponse.json({ error: "저장에 실패했어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
