import { foodLabel, yearsInBusiness, type Place } from "@/data/places";
import { isMobileDevice } from "@/lib/navigation";
import { placeUrl } from "@/lib/site";
import { showToast } from "@/lib/toast";

export const SHARE_COPIED_MESSAGE = "가게 정보와 지도 링크를 복사했어요. 카카오톡에 붙여넣어 보세요!";

/**
 * 공유 텍스트:
 * [브라보 마이 라이프] {가게명} ({업력 N년} · {음식 업종})
 * 📍 {주소}
 * 🗺️ 지도 보기: https://map.kakao.com/link/map/{name},{lat},{lng}
 * 🔗 상세 보기: {SITE_URL}/place/{id}   (노포만 — 미리보기(OG)가 가게 이름·업력으로 뜬다)
 */
export function buildShareText(p: Place): string {
  const parts: string[] = [];
  const years = p.mode === "nopo" ? yearsInBusiness(p) : null;
  if (years !== null) parts.push(`업력 ${years}년`);
  else if (p.badge) parts.push(p.badge);
  const food = foodLabel(p);
  if (food) parts.push(food);

  const lines = [`[브라보 마이 라이프] ${p.name}${parts.length ? ` (${parts.join(" · ")})` : ""}`];
  if (p.address) lines.push(`📍 ${p.address}`);
  lines.push(`🗺️ 지도 보기: https://map.kakao.com/link/map/${encodeURIComponent(p.name)},${p.lat},${p.lng}`);
  if (p.mode === "nopo") lines.push(`🔗 상세 보기: ${placeUrl(p.id)}`);
  return lines.join("\n");
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 권한/보안 컨텍스트 문제 → 아래 폴백 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** 모바일은 공유 시트(navigator.share), 미지원/실패(취소 제외)는 클립보드 복사 + 토스트 */
export async function sharePlace(p: Place) {
  const text = buildShareText(p);
  if (isMobileDevice() && typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // 사용자가 닫음: 아무것도 하지 않는다
      /* 그 외 실패는 클립보드로 폴백 */
    }
  }
  showToast((await copyText(text)) ? SHARE_COPIED_MESSAGE : "복사하지 못했어요. 잠시 후 다시 시도해 주세요.");
}
