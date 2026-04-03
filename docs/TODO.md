# TODO

## Completed
- [x] 관리자 대시보드 MVP 구현 (로그인, 챗봇 CRUD, SearchTierEditor)
- [x] HttpOnly Cookie 인증 전환 (logout, me, CSRF 방어 포함)
- [x] configs.py 하드코딩 제거, DB single source of truth
- [x] 백엔드 테스트 30개 + 프론트엔드 테스트 25개
- [x] Gemini LLM Re-ranking 구현 (retrieval 50 → rerank → context 5, graceful degradation)
- [x] ChatService 단일 commit 전환 + chatbot_config_id nullable 수정
- [x] ChatService 통합 테스트 7개 + Reranker 테스트 6개 추가 (총 81개)
- [x] E2E 테스트 Playwright 12개 (로그인, 챗봇 CRUD, 인증 가드)
- [x] Phase 2A 데이터 파이프라인 (extractor/metadata/chunker kss/progress/reporter/ingest CLI)
- [x] 멀티포맷 텍스트 추출 (PDF pymupdf + DOCX python-docx + TXT, HWP 제출 제한)
- [x] 폴더 기반 A/B source 자동 분류 + 증분 적재 + 배치 리포트
- [x] 파이프라인 테스트 31개 추가 (총 112개)

## Next Actions

### E2E 테스트 (Playwright)
- **What:** 로그인 → 챗봇 목록 → 편집 → search_tiers 수정 → 저장 전체 플로우 E2E 테스트
- **Why:** 컴포넌트 테스트로 잡지 못하는 통합 문제(인증 플로우, 라우팅, Cookie 전달) 검증
- **Pros:** 실제 사용자 플로우 검증, 회귀 방지
- **Cons:** 설정 복잡도, 실행 시간, 백엔드+프론트 동시 실행 필요
- **Context:** 현재 백엔드 pytest + 프론트 Vitest로 단위/컴포넌트 테스트는 충분하지만, Cookie 기반 인증이 브라우저에서 실제로 작동하는지는 E2E로만 검증 가능. Playwright 권장.
- **Depends on:** MVP 구현 완료 (완료됨), 테스트용 DB seed 스크립트 (존재함: scripts/seed_chatbot_configs.py)

### CI/CD 파이프라인 + 배포 설정
- **What:** admin 프론트엔드 빌드/배포 파이프라인 구성
- **Why:** 코드 변경 시 자동 빌드/배포 없이는 매번 수동 배포 필요. 운영 안정성 저하.
- **Pros:** 자동화된 배포, 재현성, 빌드 실패 조기 감지
- **Cons:** 배포 플랫폼 선정 필요
- **Context:** 현재 배포 플랫폼 미결정 상태 (Open Question). Vercel이 Next.js에 가장 자연스럽지만, 백엔드(FastAPI)와 함께 자체 서버 배포도 가능. admin/ 디렉토리에서 `next build && next start`로 실행 가능.
- **Blocked by:** 배포 플랫폼 결정 (Vercel / Netlify / 자체 서버) [확인 필요]

### 임베딩 중복 계산 최적화
- **What:** cascading_search에서 동일 query 임베딩을 1회만 계산하고 티어별 재사용
- **Why:** 3티어 검색 시 dense+sparse 임베딩을 매번 재계산하여 ~600-1500ms 낭비
- **Pros:** 검색 레이턴시 30-50% 개선
- **Cons:** hybrid_search 인터페이스 변경 필요 (사전 계산된 임베딩 파라미터 추가)
- **Context:** hybrid_search가 호출될 때마다 embed_dense_query + embed_sparse_async를 재실행. cascading_search 레벨에서 임베딩을 미리 계산하고 전달하면 해결.
- **Depends on:** 없음. 프로덕션 최적화 시 착수.

### 검색 파이프라인 에러 핸들링
- **What:** Qdrant/임베딩/Gemini 실패 시 사용자 친화적 에러 메시지 반환
- **Why:** 현재 외부 서비스 장애 시 500 에러가 그대로 사용자에게 노출됨 (critical gap)
- **Pros:** UX 개선, 장애 원인 파악 용이
- **Cons:** try/except 계층 추가, 에러 분류 로직 필요
- **Context:** cascading_search, rerank, generate_answer 모두 외부 API 의존. Phase 3 보안 가드레일 작업 시 함께 처리 권장.
- **Blocked by:** Phase 3 보안 가드레일 작업

### 멀티테넌시 (organization_id 필터링)
- **What:** ChatbotConfig의 organization_id를 활용한 조직별 챗봇 분리
- **Why:** 교회별 맞춤 챗봇이 필요해지면 현재 글로벌 CRUD로는 대응 불가
- **Pros:** 조직별 데이터 격리, 권한 분리, 확장성
- **Cons:** 인증 컨텍스트에 조직 정보 추가 필요, API 전체 필터링 로직 변경, UI에 조직 선택 추가
- **Context:** 현재 관리자 2-3명이 단일 조직으로 운영 중. ChatbotConfig 모델에 organization_id (nullable UUID)가 이미 존재하므로 DB 스키마 변경 없이 확장 가능. 조직 수가 늘어나는 시점에 착수.
- **Depends on:** 다중 조직 운영 요구사항 확정 [확인 필요]
