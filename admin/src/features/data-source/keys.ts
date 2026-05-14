// data-source 도메인 React Query 키 팩토리.
//
// query key 가 raw 배열로 분산되어 있으면 일관성 파괴 + 키 변경 시 invalidate
// 누락이 발생한다 (PR #2 직전 codex 리뷰 발견: tag add/remove 후 all-volumes
// invalidate 누락 → stale cache 버그). factory 패턴으로 모든 호출자를 한 곳에서
// 관리한다.

export const dataSourceKeys = {
  all: ["data-source"] as const,

  // 카테고리 메타 (이름·색상·active/searchable 등).
  categories: () => [...dataSourceKeys.all, "categories"] as const,

  // 카테고리별 문서 통계.
  categoryStats: () => [...dataSourceKeys.all, "category-stats"] as const,

  // 전체 볼륨 (파일) 목록.
  allVolumes: () => [...dataSourceKeys.all, "all-volumes"] as const,

  // 적재 진행 상태 (completed / failed / in_progress).
  ingestStatus: () => [...dataSourceKeys.all, "ingest-status"] as const,

  // 파일별 IngestionJob 상세 (display_name 인라인 편집 대상).
  ingestionJobs: () => [...dataSourceKeys.all, "ingestion-jobs"] as const,
};
