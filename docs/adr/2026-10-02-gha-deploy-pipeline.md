# GitHub Actions 배포 파이프라인 ADR — GHCR 이미지, 승인 배포, VM 단일 배포 경로

- **작성일**: 2026-10-02
- **상태**: 결정 확정 · 구현 `feat/gha-deploy-pipeline` · VM 설치·GitHub 설정은 별도 승인 후 실행
- **대체**: [CI/CD 점검 ADR](2026-09-05-cicd-audit-decisions.md)의 D5("CD 워크플로는 복원하지 않는다")
- **관련**: [CI·독립 배포 runbook](../runbooks/ci-cd-pipeline.md) · [VM 운영 §배포와 롤백](../../infra/oracle-vm/README.md#배포와-롤백)

## 배경

D5 이후 배포는 로컬 Mac 의 `make deploy-*`(로컬 arm64 빌드 → `docker save` 전송 → VM `.env` 태그 갱신)였다. 저장소가 public 이 되고 `CI Required` 가 main 필수 체크가 되면서 D5 의 전제("1인·결제 막힌 Actions")가 사라졌고, 남은 문제는 다음이었다.

| 문제 | 실제 사례·근거 |
|---|---|
| 배포가 특정 Mac 과 그 체크아웃 상태에 묶인다 | 2026-08-06 브랜치 HEAD 배포, 2026-09-20 후퇴 배포 미수 — 가드로 막았지만 원인은 "로컬에서 빌드" 그 자체 |
| 이미지 전송이 느리고 끊긴다 | 2026-09-06 `deploy-admin` 55분 정지 |
| VM 스크립트를 손으로 `scp` 한다 | `make deploy-*` 는 compose·cron 스크립트를 복사하지 않는다 — 저장소와 VM 이 갈라진다 |
| backend 기동이 곧 승인 없는 migration 이다 | 이미지 CMD 가 `alembic upgrade head` 를 돈다 |
| "/health 200" 을 배포 증거로 썼다 | 실행 중 컨테이너가 기대 이미지인지 보지 않았다 |

## 결정

| # | 결정 | 이유 |
|---|---|---|
| D1 | **main 의 CI 성공 커밋을 GitHub 호스티드 arm64 러너(`ubuntu-24.04-arm`)에서 빌드해 GHCR public 이미지 `ghcr.io/woosung-dev/truewords-<svc>:<sha 12자>` 로 올린다** | public 저장소라 arm 러너·GHCR 이 무료다. 태그는 불변: 같은 태그가 이미 있으면 다시 빌드하지 않는다. 이미지에 secret 이 들어가지 않으므로 public 이 안전하다 — 빌드 인자는 공개 값뿐이다(D6) |
| D2 | **단계적 자동화: 지금은 수동 실행(`deploy=true`) + `production` 환경 승인일 때만 배포** | 첫 몇 번은 사람이 보며 돌린다. 자동 전환은 `release.yml` deploy job 의 `if:` 한 줄을 주석 줄로 바꾸는 것뿐이고, 그 뒤에도 환경 승인은 남는다 |
| D3 | **Actions → VM 은 강제 명령(forced command) SSH 키 — 배포 키와 migration 키를 나눈다** | `authorized_keys` 의 `restrict,command="~/truewords/bin/deploy-entry"` 로 키가 할 수 있는 일을 `status`·`rollback`·`sync`·`deploy <sha> <svc…>` 로 한정한다. `--migrate` 는 `production-migrate` 환경에만 있는 두 번째 키(강제 명령이 `TW_ALLOW_MIGRATE=1` 을 붙임)로만 받는다 — 스키마 변경 승인을 자격증명으로 강제한다. 진입점은 정규식으로 검증하고, VM 에서도 sha 가 `origin/main` 의 조상인지 다시 본다. VM 주소·호스트 키는 환경 secret 이다(공개 로그 마스킹) |
| D4 | **VM 에서 서비스를 바꾸는 코드는 `infra/oracle-vm/deploy.sh` 하나, 실행되는 것은 늘 최신 main 의 것** | Actions 와 비상 경로(`make deploy-*`·`rollback-*`)가 같은 스크립트를 부른다. 진입점은 최신 origin/main 으로 체크아웃해 그 `deploy.sh` 를 돌리고 대상 sha 는 이미지 태그를 고르는 데이터로만 넘긴다 — 옛 sha 로 되돌려도 옛 배포 코드·cron 스크립트가 되살아나지 않는다. compose·cron 스크립트도 같은 원본으로 동기화한다(손 `scp` 금지). 실행은 setsid 로 떼어 낸 프로세스에서 하고 출력은 VM `deploy-runs/` 에 남긴다 — ssh 가 끊기거나 실행이 취소돼도 교체·검사·자동 복구가 끝까지 돈다 |
| D5 | **migration 은 별도 승인** | 이미지의 `ALEMBIC_EXPECTED_HEAD` 와 DB head 가 다르면 deploy.sh 가 아무것도 바꾸지 않고 종료 3. Actions 는 `production-migrate` 환경 승인을 한 번 더 받은 뒤 백업 → `alembic upgrade head` → 교체 순으로 진행한다. DB head 가 비었거나 여러 개이거나 이미지가 모르는 revision(DB 가 앞섬)이면 백업 전에 종료 1 — migration 으로 풀 수 없는 상태다 |
| D6 | **빌드 인자는 커밋된 `infra/oracle-vm/build-args.env`** (시연 관리자 이메일만 저장소 Variable) | 저장소 Variable 은 바꿔도 태그가 그대로라 "같은 태그, 다른 내용" 이 생긴다. 파일이면 플래그 변경이 커밋이 되고 해당 서비스 재배포로 이어진다. 빌드 설정 해시를 이미지 라벨로 남겨, 다른 인자로 만든 기존 태그를 재사용하려 하면 실패한다 |
| D7 | **롤백 정책** | 교체 후 검사(이미지 ID·healthy·내부 HTTP·backend 는 DB head)가 실패하면 deploy.sh 가 즉시 이전 태그로 되돌린다(종료 5). 공개 URL 스모크가 실패하면 Actions 가 `rollback` 을 부른다 — 단, 검증 직전 VM 상태를 읽지 못하면(ssh) 롤백하지 않고 알린다. **migration 이 돈 배포는 backend 를 자동 롤백하지 않는다** — 이전 backend 이미지는 새 revision 을 몰라 기동하지 못한다. 같은 배포에서 바뀐 admin·web 은 이전 태그로 되돌린다 |
| D8 | **알림은 GitHub Issue(+ GitHub 메일), ntfy 는 선택** | 휴대폰 앱을 설치하지 않으므로 ntfy 를 1차 채널로 쓸 수 없다. 배포·빌드가 실패하면 `[deploy-alert]` 이슈를 열거나 열린 이슈에 댓글을 달고, 다음 배포가 성공하면 닫는다(열린 알림은 늘 0~1개). 새 이슈는 저장소 소유자에게 메일로 간다. `NTFY_TOPIC` secret 이 있을 때만 ntfy 를 덧붙인다 |
| D9 | **GHCR 보존은 `dataaxiom/ghcr-cleanup-action`**, 서비스마다 태그 15개 + 태그 없는 버전·고아 정리 | `actions/delete-package-versions` 의 untagged 삭제는 multi-arch 이미지의 하위 manifest 를 지워 태그를 깨뜨릴 수 있다. 예약 실행은 `GHCR_CLEANUP_ENABLED=true` 전까지 dry-run 이다 |
| D10 | **VM 불변식 알림은 Actions 가 당겨 간다(`ops-alert.yml`)** | VM 에 GitHub 토큰을 두지 않는다. 매일 ops-check 35분 뒤 `ops-read` 환경의 읽기 전용 키(강제 명령이 `ops-status` 만 실행)로 `/opt/ops-status.json` 을 읽어, FAIL·WARN·접속 실패·낡은 결과(26시간 초과)·형식 오류면 `[ops-alert] VM 점검` 이슈를 열고 정상이면 그 이슈만 닫는다. VM cron 이 멈추면 이쪽이, Actions 가 멈추면 VM 쪽 ntfy(선택)가 남아 서로 다른 실패 도메인에서 덮는다. 이슈 본문은 공개라 버킷 이름·키 지문·IP 를 가리고 ssh 오류 원문을 싣지 않는다 |

## 하지 않기로 한 것

- **public 저장소의 self-hosted 러너(VM 에 러너 설치)**: 포크 PR 이 VM 에서 코드를 실행할 수 있는 구성이다. GitHub 도 public 저장소에 권하지 않는다.
- **Watchtower 류 자동 pull**: 승인·migration 게이트·롤백 기록을 둘 자리가 없고, 2025-12 에 저장소가 보관(archived)됐다.
- **Kamal**: 같은 VM 의 다른 스택(kairos·quantbridge·nexus)과 compose 구성을 흡수해야 하고, 1인 운영에는 도구 하나를 더 배우는 비용이 더 크다.
- **Tailscale 등 VPN 경유 SSH**: 지금은 강제 명령 키 + 호스트 키 고정으로 충분하다. SSH 포트를 닫아야 할 때 다시 본다.

## 남은 공백 — 정직하게

- 알림 job 도 Actions 위에서 돈다. Actions 자체가 멈추면 배포 알림도 없다(그때는 배포도 일어나지 않는다). VM 쪽 불변식은 `ops-check.sh` 가 결과 기준으로 계속 보지만, 그 결과를 사람에게 전하는 `ops-alert.yml` 도 Actions 라 같은 사고에서는 ntfy(설정했을 때)만 남는다.
- migration 을 넘는 backend 롤백은 자동화하지 않았다. 백업 복원과 함께 사람이 판단한다.
- `[확인 필요]` 기본 `GITHUB_TOKEN` 으로 GHCR 버전 삭제가 되는지 — 첫 dry-run 해제 전에 수동 실행으로 확인한다.
