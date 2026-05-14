// 도메인 공통 유틸리티 타입을 모아두는 진입점.

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
