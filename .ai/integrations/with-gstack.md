# gstack과 함께 사용하기

> [gstack](https://github.com/garrytan/gstack) — 가상 엔지니어링 팀 스킬 팩

## 설치

```bash
# 글로벌 설치
git clone https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup

# 또는 프로젝트별 설치
git clone https://github.com/garrytan/gstack.git .claude/skills/gstack
cd .claude/skills/gstack && ./setup
```

## gstack이 하는 일

20+ 슬래시 커맨드로 AI에게 **전문가 역할**을 부여합니다:

```
Think → Plan → Build → Review → Test → Ship → Reflect
```

주요 커맨드:
- `/office-hours` — 기획 브레인스토밍 (CEO 관점)
- `/plan-ceo-review` — CEO 관점 기획 검토
- `/plan-design-review` — 디자이너 관점 UI 검토
- `/plan-eng-review` — 엔지니어링 매니저 관점 기술 검토
- `/review` — 코드 리뷰
- `/qa` — QA 테스트
- `/ship` — 릴리스 점검
- `/browse` — 내장 Playwright 브라우저로 실제 웹 테스트
- `/cso` — 보안 검토

## ai-rules와의 관계

| 영역 | ai-rules | gstack | 관계 |
|------|----------|--------|------|
| 기본 역할 | Senior Tech Lead | 없음 (커맨드 호출 시에만 활성) | **ai-rules 기본값** |
| 코드 리뷰 | 없음 | `/review` | gstack 추가 |
| QA 테스트 | 없음 | `/qa`, `/browse` | gstack 추가 |
| 코딩 규칙 | 스택별 상세 규칙 | 없음 | **ai-rules 전담** |
| 아키텍처 패턴 | FSD, 레이어 분리 등 | 없음 | **ai-rules 전담** |

**충돌이 거의 없습니다.** gstack은 "관점"을 추가하고, ai-rules는 "규칙"을 정의합니다.

## 사용 패턴

### 기본 개발 시

ai-rules의 규칙을 따라 코드 작성. gstack 커맨드 불필요.

### 검토가 필요할 때

```
(코드 작성 완료 후)
/review          → 코드 리뷰
/qa              → QA 관점 테스트
/plan-design-review → UI/UX 검토
```

### 배포 전

```
/cso             → 보안 검토
/ship            → 릴리스 체크리스트
```

## 조정이 필요한 부분

### 역할 정의

ai-rules의 §2 "Senior Tech Lead"는 **기본 역할**입니다.
gstack 커맨드를 호출하면 해당 역할로 전환되고, 커맨드 완료 후 기본 역할로 돌아옵니다.
ai-rules의 역할 정의를 수정할 필요 없습니다.

### Git Safety Protocol

gstack의 `/ship`은 배포 프로세스를 안내하지만,
ai-rules의 Git Safety Protocol(커밋/푸쉬 전 사용자 승인)이 여전히 우선합니다.

## 요약

- **설치만 하면 됩니다.** ai-rules 파일 수정 불필요.
- gstack은 필요할 때 슬래시 커맨드로 호출. 항상 활성화되지 않음.
- ai-rules가 코딩 규칙을, gstack이 다양한 관점 검토를 담당합니다.

---

## TrueWords 프로젝트 컨텍스트

gstack 커맨드 실행 시 아래 프로젝트 문서를 참조하세요:

| gstack 커맨드 | 참조 docs |
|---|---|
| `/plan-eng-review` | `docs/04_architecture/02-architecture-design.md`, `docs/04_architecture/05-rag-pipeline.md` |
| `/plan-design-review` | `docs/dev-log/17-design-strategy.md`, `docs/01_requirements/16-app-feature-spec.md` |
| `/plan-ceo-review` | `docs/dev-log/14-success-factors-strategy.md`, `docs/dev-log/12-market-analysis.md` |
| `/cso` | `docs/04_architecture/09-security-countermeasures.md` |
| `/review` | `.ai/stacks/fastapi/backend.md`, `.ai/project/rag-pipeline.md` |
| `/qa` | `docs/01_requirements/16-app-feature-spec.md` (비기능 요구사항 섹션) |

### 프로젝트 핵심 스택

- **AI:** Gemini 2.5 Flash/Pro (NOT Claude/OpenAI)
- **벡터 DB:** Qdrant (NOT pgvector/Pinecone)
- **운영 DB:** PostgreSQL (사용자, 로그, 설정만)
- **프론트엔드:** Next.js 16 (Admin Dashboard) + Flutter (Mobile, Phase 4)
- **백엔드:** FastAPI (100% async)
