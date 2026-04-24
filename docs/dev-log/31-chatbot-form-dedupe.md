# 부수 S3 — 프론트 챗봇 폼 중복 제거 (§13.3)

- **작성일**: 2026-04-25
- **상태**: 완료 (Vitest 6 PASS 신규, TypeScript 0 에러, 기존 테스트 비회귀)
- **관련 파일**:
  - `admin/src/features/chatbot/components/chatbot-form.tsx` (신규)
  - `admin/src/app/(dashboard)/chatbots/new/page.tsx` (간소화)
  - `admin/src/app/(dashboard)/chatbots/[id]/edit/page.tsx` (간소화)
  - `admin/src/test/chatbot-form.test.tsx` (신규)
  - 플랜 §13.3 S3

## 왜

§13.3 S3. new/edit 두 페이지에 동일한 **11개 state 선언 + 3개 섹션 JSX 거의 복붙**. 새 필드 추가 시 양쪽 동시 수정 필요 → 실수 유발.

## 변경

### 신규 `ChatbotForm` 컴포넌트 (`admin/src/features/chatbot/components/chatbot-form.tsx`)

- 단일 source: 11개 state(`display_name`, `description`, `persona_name`, `system_prompt`, `is_active`, `tiers`, `search_mode`, `weighted_sources`, `dictionary_enabled`, `query_rewrite_enabled`, `chatbot_id`) + 3 섹션 JSX (기본 정보 · 페르소나 · 검색 설정) + 하단 액션 바.
- Props: `mode: "create" | "edit"`, `initialValues` (Partial, optional), `onSubmit`, `isSubmitting`, `submitLabel`/`submitPendingLabel`, `onCancel`, `cancelLabel`.
- `mode === "create"` 에서만 `chatbot_id` 입력 필드 노출.
- `onSubmit: (values) => void | Promise<unknown>` — `useMutation.mutateAsync` 반환값 흡수.
- edit 모드에서 `initialValues` 가 비동기(useQuery 후) 로 들어올 경우 1회 반영 (`initialized` 플래그).

### 페이지 간소화

| 파일 | 이전 | 이후 |
|------|------|------|
| `new/page.tsx` | 242 lines | **56 lines** (mutation + `<ChatbotForm mode="create">`) |
| `edit/page.tsx` | 292 lines | **130 lines** (useQuery + mutation + `<ChatbotForm mode="edit" initialValues={...}>` + Skeleton/Error) |

## 테스트

### 신규 `chatbot-form.test.tsx` 6 PASS

- `create 모드에서 Chatbot ID 필드가 렌더된다`
- `edit 모드에서 Chatbot ID 필드가 렌더되지 않는다`
- `edit 모드에서 initialValues 의 display_name 이 반영된다`
- `create 모드 submit 시 onSubmit 이 입력값과 함께 호출된다` — `search_tiers` 기본값 포함 검증
- `isSubmitting=true 이면 submit 버튼이 비활성화되고 pending 라벨이 노출된다`
- `취소 버튼 클릭 시 onCancel 이 호출된다`

### TypeScript

`cd admin && npx tsc --noEmit` → **0 에러**.

### 기존 테스트 비회귀

- `search-tier-editor.test.tsx` · `queries-page.test.tsx` · `query-detail-modal.test.tsx` · `api.test.ts` 모두 PASS.
- `login.test.tsx`: **기존 1건 flaky** (`waitFor` 로 `mockPush.toHaveBeenCalledWith("/chatbots")` 타임아웃). 단독 실행에도 실패 — 이 S3 작업과 **무관**. 별도 이슈로 추적.

## 효과

- 새 검색 모드/옵션 추가 시 `ChatbotForm` 한 곳만 수정.
- 페이지 코드 LOC **~56% 감소** (242→56 / 292→130).
- 테스트 커버리지 신규 진입 — 기존엔 하위 컴포넌트(`SearchTierEditor` 등) 개별만 테스트, 폼 전체 통합 테스트 없었음.

## 후속 (이번 세션 범위 밖)

- 플랜 §13.3 에 언급된 `useChatbotForm` hook 추출은 **생략** — state 11개 + patch helper 가 컴포넌트 내부에 있어도 읽기 충분. React Hook Form + Zod 스키마 도입도 현재 복잡도 대비 과잉으로 판단.
- `login.test.tsx` flaky 조사: push mock 과 `next/navigation` 의 상호작용 추정. `vi.hoisted` / `vi.resetAllMocks` 로 격리 재검토. 별도 작업.

## 다음 단계

- 이번 세션 마감. 남은 리팩토링 작업:
  - **선행 #2 Staging 인프라 프로비저닝** — 사용자 GCP 작업 (staging-separation.md §9)
  - **선행 #3 운영 Qdrant dry-run** — staging 후
  - **선행 #5 품질 게이트 기준선** — staging 후
  - **v4.1 N2/N3/N7** — R1/R2/R3 본 리팩토링 맥락
  - **R1/R2/R3 본 리팩토링** — 품질 기준선 확보 후
