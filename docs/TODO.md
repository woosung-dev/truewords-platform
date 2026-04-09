# TODO

## Completed
- [x] 관리자 대시보드 MVP 구현 (로그인, 챗봇 CRUD, SearchTierEditor)
- [x] HttpOnly Cookie 인증 전환 (logout, me, CSRF 방어 포함)
- [x] configs.py 하드코딩 제거, DB single source of truth
- [x] 백엔드 테스트 30개 + 프론트엔드 테스트 25개
- [x] Gemini LLM Re-ranking 구현 (retrieval 50 → rerank → context 5, graceful degradation)
- [x] ChatService 단일 commit 전환 + chatbot_config_id nullable 수정
- [x] ChatService 통합 테스트 7개 + Reranker 테스트 6개 추가
- [x] E2E 테스트 Playwright 12개 (로그인, 챗봇 CRUD, 인증 가드)
- [x] Phase 2A 데이터 파이프라인 (extractor/metadata/chunker kss/progress/reporter/ingest CLI)
- [x] 멀티포맷 텍스트 추출 (PDF pymupdf + DOCX python-docx + TXT)
- [x] 폴더 기반 A/B source 자동 분류 + 증분 적재 + 배치 리포트
- [x] 파이프라인 테스트 31개 추가
- [x] **Phase 3 보안 가드레일** — Prompt Injection 방어 (17패턴), Rate Limiting (20req/min/IP), 답변 면책 고지
- [x] **SSE 스트리밍 응답** — POST /chat/stream 엔드포인트, Gemini 스트리밍, chunk→sources→done 이벤트
- [x] **Semantic Cache** — Qdrant semantic_cache 컬렉션, 유사도 0.93, TTL 7일, chatbot_id 격리
- [x] **배포 인프라 + CI/CD** — Dockerfile, GitHub Actions (CI/Deploy), Vercel 설정, docs 문서화
- [x] **임베딩 중복 계산 최적화** — dense/sparse 1회 계산 후 모든 티어에서 재사용
- [x] **Alembic 초기 마이그레이션** — init_db() 프로덕션 스킵, 마이그레이션 파일 생성
- [x] 테스트 총 190개 (백엔드 190 + 프론트엔드 Vitest 25 + E2E 12)
- [x] GCP/Vercel 프로덕션 실제 인프라 배포 완료

## Blocked
- [ ] 종교 용어 사전 동적 주입 — 대사전 데이터 미확보 [데이터 수급 필요]
- [ ] 민감 인명 필터 구체화 — SENSITIVE_PATTERNS 목록 비어있음 [도메인 전문가 협의 필요]
- [ ] 멀티테넌시 (organization_id 필터링) — 다중 조직 운영 요구사항 미확정 [확인 필요]

## Questions
- Flutter 모바일 앱 시작 시점? — 레드팀 테스트 후 Phase 4에서 진행 예정
- GCP 실제 배포 시점? — 인프라 설정 파일 완료, GCP 프로젝트 생성 + 수동 설정 필요

## Next Actions

### 0. 임베딩 Batch API 지원 (유료 전용)
- [ ] Gemini Batch API로 인제스트 옵션 추가 ($0.075/M, Standard 대비 50% 할인)
- [ ] 관리자 UI에서 Standard/Batch 모드 선택 가능하도록
- [ ] Batch 흐름: 청크 → Google 배치 제출 → 상태 폴링 → 결과 수신 → Qdrant 적재
- [ ] 배치 상태 관리 (batch_id 저장, 진행률 표시, 실패 처리)
- [ ] 무료 티어에서는 Batch 선택 비활성화 (유료 전용)
- 참고: Standard는 실시간 처리 (현재 구현), Batch는 비동기 24시간 내 처리
- 참고: 결과물(벡터)은 Standard와 동일, 비용만 다름
- 참고: 1GB 기준 Standard ~$37 vs Batch ~$19

### 1. 레드팀 테스트
- 내부 팀 대상 악의적 질문 테스트
- 보안 가드레일 검증 (Prompt Injection, Rate Limiting)
- 답변 품질/출처 정확도 평가

### 3. 검색 파이프라인 에러 핸들링
- Qdrant/임베딩/Gemini 실패 시 사용자 친화적 에러 메시지
- 현재 외부 서비스 장애 시 500 에러 노출

### 4. Flutter 모바일 앱 (Phase 4)
- 레드팀 테스트 완료 후 착수
- MVP 3개 화면: 채팅(SSE), 챗봇 선택, 설정/온보딩
- Feature-First + Riverpod + go_router + freezed
