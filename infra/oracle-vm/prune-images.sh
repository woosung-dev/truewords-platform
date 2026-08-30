#!/usr/bin/env bash
# truewords 이미지 GC — 최신 N개와 실행 중 이미지를 남기고 나머지를 지운다.
#
# ── 왜 이 스크립트가 필요한가 ────────────────────────────────────────────────
# 2026-08-30 실측에서 VM 디스크가 한 달 만에 18G → 43G 로 늘었다(97G 중 45%).
# 증가분의 대부분이 Docker 이미지였다. `docker load` 는 기존 이미지를 지우지
# 않고, 배포마다 truewords-backend:<sha> 가 UNIQUE 1.79GB 씩 쌓였다.
# 미사용 5개가 9GB 를 잠그고 있었다.
#
# 롤백을 위해 이전 이미지를 남기는 것은 의도된 설계다
# (docs/07_infra/oracle-vm-migration.md §7). 없었던 것은 그 보존의 상한이다.
#
# ── 왜 `docker image prune` 이 아닌가 ────────────────────────────────────────
# prune 은 dangling(태그 없는) 이미지만 지운다. 이 VM 의 구버전 이미지는 전부
# 커밋 sha 태그를 달고 있어 dangling 이 아니다 — 실측 dangling 0개다. 그대로
# 넣으면 "정리 루틴을 넣었다"는 착각만 남고 디스크는 계속 찬다.
# `prune -a` 는 반대로 너무 공격적이라 롤백 대상까지 날린다.
# 그래서 태그를 생성시각순으로 정렬해 최신 N개만 남긴다.
#
# ── 왜 실행 중 이미지를 따로 보호하는가 ─────────────────────────────────────
# `make rollback-backend TAG=<옛 sha>` 로 되돌린 동안에는 그 이미지가 "최신
# N개" 밖에 있다. 생성시각 정렬만으로는 지켜지지 않는다. docker rmi 가 거부해
# 주기는 하지만, 실패로 시끄러워지는 대신 명시적으로 제외한다.
#
# ── 다른 스택을 건드리지 않는다 ─────────────────────────────────────────────
# 이 VM 에는 kairos·quantbridge 도 산다(총 18 컨테이너). REPOS 를 truewords
# 로 한정하고, 빌드 캐시도 until 필터로 최근 것은 남긴다 — quantbridge 가 VM
# 에서 빌드하므로 무조건 지우면 남의 빌드를 느리게 만든다.
#
# ── 실행 ────────────────────────────────────────────────────────────────────
#   ssh truewords-oracle 'bash ~/truewords/prune-images.sh'   (또는 `make prune-images`)
#   cron: 15 19 * * 0  — 주간. 배포가 없는 주에도 빌드 캐시가 정리되도록.
#   make deploy-backend / deploy-admin 말미에서도 호출된다.
#
# KEEP=5 처럼 환경변수로 조정할 수 있다. DRY_RUN=1 이면 지우지 않고 보여만 준다.

# set -e 를 쓰지 않는다. 한 repo 정리가 실패해도 나머지를 끝까지 처리해야 한다.
# (ops-check.sh / restore-drill.sh 에서 고친 것과 같은 부류의 함정)
set -uo pipefail

KEEP="${KEEP:-3}"
REPOS="${REPOS:-truewords-backend truewords-admin}"
CACHE_KEEP="${CACHE_KEEP:-168h}"
DRY_RUN="${DRY_RUN:-0}"

log() { echo "[$(date '+%F %T')] $*"; }

log "이미지 GC 시작 (repo당 최신 ${KEEP}개 보존, DRY_RUN=${DRY_RUN})"
BEFORE=$(df --output=used -B1 / | tail -1)

# 실행 중 컨테이너가 참조하는 이미지 — 롤백 중인 옛 태그를 여기서 건진다.
IN_USE=$(sudo docker ps -a --format '{{.Image}}' | sort -u)

for repo in $REPOS; do
  # CreatedAt 역순 → 최신 KEEP개를 건너뛴 나머지가 삭제 후보.
  CANDIDATES=$(sudo docker image ls "$repo" --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' \
    | sort -r | tail -n "+$((KEEP + 1))" | cut -f2)

  if [ -z "$CANDIDATES" ]; then
    log "  ${repo}: 삭제 대상 없음"
    continue
  fi

  for img in $CANDIDATES; do
    if grep -qxF "$img" <<< "$IN_USE"; then
      log "  ${img}: 실행 중이라 보존"
      continue
    fi
    if [ "$DRY_RUN" = "1" ]; then
      log "  ${img}: [dry-run] 삭제 예정"
    else
      sudo docker image rm "$img" >/dev/null 2>&1 \
        && log "  ${img}: 삭제" \
        || log "  ${img}: 삭제 실패 (참조 중일 수 있음)"
    fi
  done
done

# 빌드 캐시 — truewords 는 로컬 Mac 에서 빌드해 docker load 하므로 캐시를
# 만들지 않는다. 여기 쌓이는 것은 같은 VM 의 다른 스택 몫이라 until 로 최근
# 것은 남긴다.
if [ "$DRY_RUN" = "1" ]; then
  log "빌드 캐시: [dry-run] until=${CACHE_KEEP} 이전 정리 예정"
else
  RECLAIMED=$(sudo docker buildx prune -f --filter "until=${CACHE_KEEP}" 2>/dev/null | tail -1)
  log "빌드 캐시: ${RECLAIMED:-정리 없음}"
fi

AFTER=$(df --output=used -B1 / | tail -1)
FREED=$(( (BEFORE - AFTER) / 1024 / 1024 ))
log "완료 — ${FREED}MB 회수, 디스크 $(df --output=pcent / | tail -1 | tr -d ' ') 사용"
