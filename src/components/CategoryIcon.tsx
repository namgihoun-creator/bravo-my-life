import {
  Award,
  BatteryCharging,
  Beer,
  Car,
  Clock3,
  Heart,
  LayoutGrid,
  MapPin,
  ParkingSquare,
  Pill,
  Printer,
  Soup,
  Toilet,
  User,
  Utensils,
  WashingMachine,
  type LucideIcon,
} from "lucide-react";

/**
 * 필터 칩·카드 배지·지도 상세 카드가 함께 쓰는 단일 아이콘 매핑(키 = 필터 key / DB category).
 * 규격: lucide 14px, strokeWidth 2, currentColor 상속(활성/비활성 색은 부모 버튼이 정한다). 이모지는 쓰지 않는다.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  // 공통 칩
  all: LayoutGrid,
  fav: Heart,
  "open-now": Clock3,
  // 긴급 생존 모드
  laundry: WashingMachine,
  print: Printer,
  pharmacy: Pill,
  battery: BatteryCharging,
  parking: ParkingSquare,
  carwash: Car,
  toilet: Toilet,
  // 찐노포 탐색 모드: 연차 칩은 업력 뱃지(Award)와 같은 아이콘
  y10: Award,
  y15: Award,
  y20: Award,
  y30: Award,
  // 노포 업종
  soup: Soup,
  pocha: Beer,
  solo: User,
  general: Utensils,
};

export default function CategoryIcon({
  k,
  size = 14,
  className = "",
  fill = false,
}: {
  k: string;
  size?: number;
  className?: string;
  /** 채움(찜 1건 이상 등). 색은 currentColor 라 칩 색을 그대로 따른다. */
  fill?: boolean;
}) {
  const Icon = CATEGORY_ICONS[k] ?? MapPin;
  return (
    <Icon
      size={size}
      strokeWidth={2}
      aria-hidden
      fill={fill ? "currentColor" : "none"}
      className={`shrink-0 ${className}`}
    />
  );
}
