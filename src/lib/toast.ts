/** 앱 어디서나 쓰는 가벼운 토스트. <ToastHost />(layout)가 화면에 띄운다. */
const EVENT = "bml-toast";

export function showToast(message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

export function subscribeToast(cb: (message: string) => void) {
  const handler = (e: Event) => cb((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
