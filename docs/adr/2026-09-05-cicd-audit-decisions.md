# CI/CD 점검 결정 ADR — 보호 없는 main, 재발한 청구 차단, 죽은 Vercel, 전달 없는 감시

- **작성일**: 2026-09-05
- **상태**: 결정 확정 · 구현 `dev/cicd-hardening` 통합 브랜치 (sub-PR 5개) · 외부 작업(public 전환·Vercel 삭제·시크릿 삭제·VM 반영)은 별도 승인 후 실행
- **관련**: [CI·독립 배포 runbook](../runbooks/ci-cd-pipeline.md) · [통합 브랜치 워크플로](../runbooks/integration-branch-workflow.md) · [예약 작업 조용한 실패 ADR](2026-07-30-silent-scheduled-job-failure.md) · [VM 운영](../../infra/oracle-vm/README.md)

## 배경

2026-09-05 모노레포 전환(PR #222) 직후 CI/CD 를 점검했다. 워크플로우는 새 구조로 갱신돼 있었지만, **저장소 밖의 연동과 감시의 마지막 단계**가 옛 구조·옛 인프라 기준으로 남아 있었다. 최근 60일 동안 이 축에서 사고가 3건 났다.

## 실측으로 확인한 사실 (2026-09-05 19:30 KST, main `2c1332a`)

| 영역 | 사실 | 근거 |
|---|---|---|
| main 보호 | `protected: false`. Free 플랜 private 레포라 branch protection·rulesets API 가 403. `CI Required` 는 표시용, `gh pr merge --auto` 는 CI 를 기다리지 않음 | `gh api repos/…/branches/main`, `…/rulesets` |
| 청구 차단 재발 | **07-27~07-31, 08-07~08-31(25일)** 두 구간. job annotation `The job was not started because recent account payments have failed or your spending limit needs to be increased`, `steps_count: 0`. 그동안 `cache-cleanup.yml` 미실행, 08-30 PR 3건이 CI 없이 머지. 월초에 자동 복구 | `gh run list`, check-run annotations |
| post-merge CI | main 브랜치 CI run 0건 (`on: pull_request` 만) | `gh run list --branch main` |
| 시크릿 | 7개 중 워크플로우 참조 2개(`QDRANT_URL`·`QDRANT_API_KEY`). `DATABASE_URL`(Neon, 삭제된 DB)·`GEMINI_API_KEY`·`GEMINI_TIER`·`ADMIN_JWT_SECRET`·`ADMIN_FRONTEND_URL` 은 Cloud Run 시절 잔재 | `gh secret list`, `grep secrets\.` |
| Vercel | 프로젝트 `truewords-platform` 의 Root Directory 가 `admin`(레포에 없음) → main 머지 Production 배포 실패(`The specified Root Directory "admin" does not exist`). 살아 있던 307 리다이렉트는 **분리 전 마지막 성공 배포**가 서빙. 모든 PR 에 실패 status 부착 | `vercel project inspect`, `vercel inspect --logs` |
| 감시 전달 | `ops-check.sh` 는 7건을 탐지하고 `/opt/ops-status.json` 에 쓰지만 **push 채널이 0**. 25일 미실행을 아무도 몰랐던 직접 원인 | 스크립트 본문 |
| 배포 추적 | `make deploy-*` 가 체크아웃 HEAD 로 이미지를 만들고 main 포함·클린 트리를 검사하지 않음(2026-08-06 브랜치 배포 사고). `deploy-web` 은 ops-check 미호출 | `Makefile` |
| 로컬 재현 | `make ci` 는 ci.yml 과 "동일" 이라 문서화됐지만 E2E·`bash -n` 이 없음. `make backend-test` 의 `--ignore` 는 삭제된 파일. `uv sync --all-groups` 가 CI 에 `eval` 그룹(ragas·langchain·pandas) 설치 | `Makefile`, 워크플로우 |

`[가정]` 청구 차단은 계정 공용 무료 분(private 2,000분/월, 다른 private 레포와 공유) 소진 + 지출 한도 $0 이 원인이다. 월초 복구 패턴과 일치하지만 billing API(`user` 스코프 필요)로 확정하지는 않았다.

## 결정

| # | 결정 | 대안과 이유 |
|---|---|---|
| D1 | **레포 public 전환, GitHub Free 유지** | Pro($4/월)는 결제 수단 문제가 그대로라 같은 사고가 반복될 수 있다. public 은 branch protection·rulesets·Actions 무료(표준 러너)·Dependabot·secret scanning 을 한 번에 연다. 사전 점검(시크릿 히스토리 스캔·개인 이메일·`reports/*.jsonl`·LICENSE·**2026-04-29 private 복귀 이유**)이 선행된다 |
| D2 | **Vercel 프로젝트 즉시 삭제** | "Git 연동 해제 + 날짜 일몰" 도 가능했지만 사용자가 즉시 삭제를 택했다. 기존 종료 조건 "유입 로그 0 수렴" 은 Hobby 플랜 로그 보존(약 1시간)으로 측정할 수 없었다. 양 앱의 host 조건부 redirect 와 테스트를 함께 제거 |
| D3 | **알림 채널은 ntfy.sh** | Slack/Discord webhook·OCI Notifications 대비 계정·IAM 이 전혀 없고 VM `.env` 의 토픽 이름 하나로 끝난다. FAIL/WARN 일 때만 보내고 OK 는 보내지 않는다(초록이 매일 오면 빨강도 묻힌다). 전송 실패는 판정을 바꾸지 않는다 |
| D4 | **cache-cleanup 은 GHA 유지** (PR #211 정책 유지) | VM cron 이전(Qdrant 가 같은 VM)도 타당했지만, D1 로 청구 차단 원인이 제거되므로 orchestration 정책을 뒤집지 않는다. 미실행은 VM `ops-check` 의 `cache-ttl` 이 결과 기준으로 잡고 D3 로 전달한다 |
| D5 | **CD 워크플로는 복원하지 않는다** | 1인·Always Free VM 에는 로컬 arm64 빌드 + `docker save \| ssh` 가 맞다. 대신 `deploy-guard`(HEAD ∈ origin/main + 클린 트리, `FORCE_DEPLOY=1` 예외는 기록에 남김)와 VM `deploy.log`, 그리고 main push CI 로 "검증된 것만 배포" 를 성립시킨다 |
| D6 | **시연 관리자 게이트 이메일을 env 로** | public 레포에 개인 이메일 하드코딩을 두지 않는다. API `DEMO_ADMIN_EMAIL`, admin 빌드 `NEXT_PUBLIC_DEMO_ADMIN_EMAIL`, E2E `E2E_ADMIN_EMAIL`. **빈 게이트는 아무도 통과하지 못한다**(빈 값과 빈 이메일의 "일치" 로 새지 않게). 운영 반영 순서: VM `.env` → `deploy-backend` → `deploy-admin DEMO_ADMIN_EMAIL=…` |

## 하지 않기로 한 것

- Action 전체 SHA 핀(major 태그로 충분, 제3자 `dorny/paths-filter` 만 P2 에서 핀), Dependabot 버전 PR 무제한, OCI Notifications, `next dev`→standalone E2E 전환, staging 재도입, `ci-status.mjs` self-gating 대응(1인 개발에 위협 모델 없음).

## 구현 (통합 브랜치 `dev/cicd-hardening`)

| sub-PR | 내용 | 검증 |
|---|---|---|
| `fix/vercel-removal` | redirect 블록·상수·테스트·ignore 항목 제거, 문서 정정 | web/admin routing 테스트, typecheck 3/3, docs-links 0 |
| `feat/ops-alert-ntfy` | `ops-check.sh` 전달 블록, `.env.example` `NTFY_TOPIC`, README §전달, ADR 후속 | `bash -n`, operations 테스트 3/3, 블록 시뮬레이션 5케이스 |
| `chore/ci-make-hardening` | push(main)·dispatch 트리거, `--all-groups` 제거, setup-uv 핀, `ci-status.mjs` 미지 job 차단, `deploy-guard`·`deploy.log`, `make ci` 정합, `make e2e`, `backend-test` 정정 | actionlint 0, tooling 16/16, dev 그룹만 pytest 971, `make -n` 전개, 가드 음성/양성 |
| `refactor/demo-admin-email-env` | D6 전부 | pytest 972, admin vitest 77, typecheck·lint·build |
| `docs/cicd-consistency` | TODO 모순 8곳, 통합 워크플로·CI runbook 보호 문구, AGENTS, 이 ADR | docs-links 0 |

## 검증 계획 (외부 작업 후)

| 항목 | 확인 |
|---|---|
| 보호 | `gh api repos/{owner}/{repo}/branches/main --jq .protected` = `true`, 체크 미완료 PR 의 머지 버튼 비활성 |
| 청구 | 전환 후 첫 `cache-cleanup.yml` 스케줄 run 과 main push run 이 green |
| Vercel | `curl -I https://truewords-platform.vercel.app/` → 404, 이후 PR 에 `Vercel` status 없음 |
| 알림 | `make ops-check` 푸시 없음 → `BACKUP_MAX_AGE_H=0` 강제 실패 → 폰 푸시 `ops-check FAIL x1` |
| 가드 | 더티 트리·브랜치에서 `make deploy-backend` 즉시 실패, `FORCE_DEPLOY=1` 통과 + `deploy.log` `forced` |
| 게이트 | 운영 반영 후 관리자 로그인·비관리자 403, `make e2e` 통과 |

## 남은 공백 — 정직하게

- **cron 자체가 안 도는 경우**는 ntfy 로도 모른다. dead-man ping(healthchecks.io 류)은 P2.
- `make e2e` 는 로컬 3001 포트 점유로 이번 세션에서 **실행하지 못했다.** `make -n` 전개와 CI 의 `ci-e2e.yml`(같은 순서)로 대신 검증했다.
- public 전환 후 계정 결제 실패 잠금이 public 레포의 무료 실행에도 영향을 주는지는 첫 스케줄 run 으로만 확인할 수 있다 `[가정]`.
- 인프라 문서 2곳(`infra/oracle-vm/README.md`·`.env.example`)에 남은 Gemini 키 소유 계정 이메일은 운영 안전 메모라 이번에 지우지 않았다. public 전환 사전 점검에서 결정한다.
