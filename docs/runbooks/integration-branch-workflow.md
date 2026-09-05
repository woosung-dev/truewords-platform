# 통합 브랜치 + Sub-task PR Workflow

여러 sub-task 가 묶이는 큰 작업 (Phase / Sprint / 멀티 파일 리팩토링 / 운영 영향 큰 변경) 을 안전하게 진행하는 3-tier PR 흐름.

---

## 1. 흐름 다이어그램

```
main (항상 안정, push 자동 배포 없음)
  ↑ (모든 sub-task 머지 + 종합 검증 후 1개 PR, 사람 review + 수동 머지)
dev/<phase 또는 작업명>  (통합 브랜치, 깨끗한 base 부터 시작)
  ↑ sub-task PR 1 (base=통합 브랜치, CI 통과 시 auto-merge)
  ↑ sub-task PR 2
  ↑ sub-task PR N
```

---

## 2. 단계별 운영

### 2.1 통합 브랜치 + worktree 셋업

```bash
# 통합 브랜치 생성 (main 에서 분기) + 별도 worktree 디렉토리에 체크아웃
cd /path/to/main-worktree
git fetch origin main
git worktree add ../tw-<name> -b dev/<phase 또는 작업명> main

# 이후 모든 작업은 새 worktree 에서
cd ../tw-<name>
```

`tw-` prefix 는 사용자 환경 일관성 유지용. `<name>` 은 작업 단위를 알 수 있도록 (예: `phase-0-rag-tuning`, `r2-refactoring`, `auth-rewrite`).

### 2.2 Sub-task PR 작성

각 sub-task 마다 통합 브랜치에서 분기:

```bash
# 통합 브랜치 위에서 sub-task 분기
git checkout dev/<phase>
git checkout -b feat/<sub-task>

# 작업 + 테스트
# ...

# commit + push
git commit -m "feat: ..."
git push -u origin feat/<sub-task>

# PR 생성 (base = 통합 브랜치)
gh pr create --draft --base dev/<phase> --head feat/<sub-task> ...
```

**원칙:**
- sub-task PR 은 base=통합 브랜치, base != main
- sub-task 끼리 서로 의존 X (파일 영역 분리)
- DRAFT 로 생성 → 작업 완료 후 ready 전환

### 2.3 Auto-merge 등록

PR ready 전환 후 auto-merge 활성화:

```bash
gh pr ready <PR#>
gh pr merge <PR#> --auto --squash --delete-branch
```

**작동 조건:**
- repo 설정 `allow_auto_merge: true` (한 번만 활성)
- `.github/workflows/ci.yml` 의 트리거에 `dev/**` 포함 (한 번만 설정)
- CI 통과 시 자동 squash merge → 통합 브랜치 누적 + sub-task 브랜치 자동 삭제

CI 가 fail 하면 머지 안 됨 — **단, `CI Required` 가 required status check 로 등록된 보호 규칙이 있을 때만이다.** 2026-09-05 점검에서 main 에 보호 규칙이 없었고(Free private 레포는 설정 불가) `--auto` 는 충돌만 없으면 즉시 머지했다. 보호 규칙(public 전환 후 ruleset)이 생기기 전까지는 사람이 결과를 보고 머지한다:

```bash
gh pr checks <PR#> --watch --fail-fast && gh pr merge <PR#> --squash --delete-branch
```

사용자가 수정 push 하면 CI 재실행 → 통과 시 (보호 규칙이 있으면) 자동 머지.

### 2.4 통합 브랜치 → main 검증

모든 sub-task PR 머지 후 통합 브랜치에서 심도 검증:

```bash
cd ../tw-<name>

# 전체 API·web/admin·계약·저장소 검사 (루트, ci.yml 과 같은 집합)
make ci

# 두 앱의 통합 E2E (격리 compose·시드까지 한 번에)
make e2e

# (선택) 골든셋 평가
```

staging 은 2026-04-25 결정으로 영구 폐기했다([ADR 39](../adr/39-staging-decision-reverse.md)). main 머지가 곧 운영 반영이 아니므로 머지 후 `make deploy-*` 를 별도 승인으로 실행한다.

검증 통과 시 main PR 생성:

```bash
gh pr create --base main --head dev/<phase> \
  --title "<phase 종합 PR 제목>" \
  --body "$(cat <<'EOF'
## Summary
... sub-task 머지 내역 요약 ...

## Test plan
- [x] 전체 backend pytest
- [x] admin pnpm test + E2E
- [ ] staging deploy 검증 (선택)
EOF
)"
```

**main PR은 auto-merge 등록 금지** — 사람 review + 수동 머지. Oracle 운영은 push 자동 배포가 없으며, 검증·머지 뒤에도 별도 승인을 받아 `make deploy-*`를 실행한다.

### 2.5 마무리 정리

main 머지 후:

```bash
# main worktree 로 돌아가서 sync
cd /path/to/main-worktree
git checkout main
git pull origin main

# 통합 브랜치 worktree 정리
git worktree remove ../tw-<name>

# 통합 브랜치 삭제 (local + remote)
git branch -d dev/<phase>
git push origin --delete dev/<phase>
```

---

## 3. 언제 통합 브랜치 패턴을 쓰는가

**적용:**
- 여러 sub-task 가 묶인 작업 (Phase / Sprint / 멀티 파일 리팩토링)
- 운영 영향 큰 변경 (단계별 검증 필요)
- 평가·실험 → 결정 → 적용 같은 다단계 흐름

**적용 X (main 직행 PR 1개로 충분):**
- 단순 typo / docs 수정
- 단일 bug fix
- 하나의 feature 가 한 PR 에 들어가는 small 작업

---

## 4. 전제 조건 (one-time 인프라 셋업)

본 워크플로우가 작동하려면 다음이 한 번 셋업되어야 한다:

1. **`ci.yml` 트리거 확장** — `pull_request: branches: [main, "dev/**"]`
2. **repo `allow_auto_merge` 활성** — `gh api -X PATCH repos/<owner>/<repo> -f allow_auto_merge=true`
3. **branch protection / ruleset** — main 과 `dev/**` 에 `CI Required` 를 required status check 로 강제. 이것이 없으면 2.3 의 auto-merge 는 CI 를 기다리지 않는다. Free private 레포에서는 설정할 수 없어(API 403) 2026-09-05 에 public 전환을 결정했다 — [ADR](../adr/2026-09-05-cicd-audit-decisions.md).

PR `chore(ci): integration-branch-auto-merge-setup` 으로 1+2 한 번에 셋업.

---

## 5. 안전 가이드 (해선 안 되는 것)

- ❌ main 으로 가는 PR 에 `--auto` 등록 — 최종 사람 검토 생략
- ❌ sub-task PR 머지 없이 통합 브랜치에 직접 commit / force-push (한 번이라도 push 후엔)
- ❌ 통합 브랜치 long-lived (4주+) — main 과 divergence 누적. 1~2주 이내 rebase / 머지
- ❌ judge LLM (RAGAS 등) CI/CD 통합 — 비용 부담, 사용자 정책으로 영구 폐기 (2026-05-01)

---

## 6. 사례

- **Phase 0 (RAG threshold 정책 정리, 2026-05-01)** — `dev/phase-0-rag-tuning` 통합 브랜치 + sub-task PR #103 (ADR), #104 (분포 로깅), #105 (평가 골격)
