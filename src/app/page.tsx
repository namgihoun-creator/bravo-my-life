import type { Metadata } from "next";
import Home from "@/components/Home";

// 홈 canonical 은 홈에만 둔다(layout 에 두면 모든 하위 라우트가 상속한다). 상세 페이지는 자체 canonical 을 가진다.
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function Page() {
  return <Home />;
}
