# TODO

## Completed
- [x] 관리자 대시보드 MVP 구현 (로그인, 챗봇 CRUD, SearchTierEditor)
- [x] HttpOnly Cookie 인증 전환 (logout, me, CSRF 방어 포함)
- [x] configs.py 하드코딩 제거, DB single source of truth
- [x] 백엔드 테스트 30개 + 프론트엔드 테스트 25개

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

### 멀티테넌시 (organization_id 필터링)
- **What:** ChatbotConfig의 organization_id를 활용한 조직별 챗봇 분리
- **Why:** 교회별 맞춤 챗봇이 필요해지면 현재 글로벌 CRUD로는 대응 불가
- **Pros:** 조직별 데이터 격리, 권한 분리, 확장성
- **Cons:** 인증 컨텍스트에 조직 정보 추가 필요, API 전체 필터링 로직 변경, UI에 조직 선택 추가
- **Context:** 현재 관리자 2-3명이 단일 조직으로 운영 중. ChatbotConfig 모델에 organization_id (nullable UUID)가 이미 존재하므로 DB 스키마 변경 없이 확장 가능. 조직 수가 늘어나는 시점에 착수.
- **Depends on:** 다중 조직 운영 요구사항 확정 [확인 필요]
