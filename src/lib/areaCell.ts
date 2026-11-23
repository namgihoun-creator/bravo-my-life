/**
 * '이 동네 데이터 요청하기' 격자. 정확한 좌표 대신 0.02°(위도 약 2.2km) 격자의 중심만 다룬다(서버·클라이언트 공용 순수 함수).
 * cell_key 는 격자 인덱스(`위도칸_경도칸`)라 같은 격자의 요청이 항상 같은 키가 된다.
 */
export const CELL_DEG = 0.02;

export interface AreaCell {
  key: string;
  lat: number;
  lng: number;
}

export function areaCell(lat: number, lng: number): AreaCell {
  const i = Math.round(lat / CELL_DEG);
  const j = Math.round(lng / CELL_DEG);
  return { key: `${i}_${j}`, lat: Number((i * CELL_DEG).toFixed(4)), lng: Number((j * CELL_DEG).toFixed(4)) };
}
