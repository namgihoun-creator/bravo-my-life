/** 사이트 기준 URL. 커스텀 도메인으로 옮길 때는 NEXT_PUBLIC_SITE_URL 환경변수 또는 이 상수 한 곳만 바꾼다. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://bravo-mylife.vercel.app").replace(/\/$/, "");

export const placeUrl = (id: string) => `${SITE_URL}/place/${id}`;
