#!/usr/bin/env bash
# 로컬 git worktree GC — main 에 머지된 worktree 만 지우고, 나머지는 보고만 한다.
#
# ── 왜 이 스크립트가 필요한가 ────────────────────────────────────────────────
# 2026-09-20 실측에서 `.claude/worktrees/` 가 7.5G 였다. 원인은 복사가 아니라
# 재생성이다 — worktree 는 추적 파일만 체크아웃하므로 node_modules·.next 는
# 애초에 복사되지 않는다. 각 worktree 안에서 `pnpm install`·`pnpm build` 가
# 따로 돌아 worktree 당 node_modules 827M + .next 최대 1.3G 가 쌓였다.
# pnpm 하드링크 공유도 아니다(링크 수 1, inode 상이) — 전부 실제 사본이다.
#
# ── 왜 Claude Code 의 자동 스윕으로 안 되는가 ───────────────────────────────
# 스윕은 `cleanupPeriodDays` 보다 오래된 것만 지운다. 이 환경은 3650(10년)이라
# 사실상 돌지 않는다. 그 값은 대화 기록 보존 기간과 공유하므로 낮출 수 없다.
# 게다가 스윕은 "미푸시 커밋이 있으면" 남겨 둔다 — 남아 있던 3개 중 2개가
# 정확히 그 경우였다(1커밋·73커밋). 설정을 고쳐도 잡히지 않는다.
#
# ── 왜 `git worktree prune` 이 아닌가 ───────────────────────────────────────
# prune 은 "디렉터리가 이미 사라진" worktree 의 메타데이터만 치운다. 디스크를
# 비우지 않는다. 순서가 반대다. 이 스크립트가 remove 를 한 뒤 마지막에 prune 을
# 불러 잔여 메타데이터를 정리한다.
#
# ── 왜 --force 를 쓰지 않는가 (이 스크립트의 안전 근거) ─────────────────────
# Claude Code 는 에이전트가 도는 동안 그 worktree 에 `git worktree lock` 을 건다.
# 잠긴 것에 remove 를 걸면 git 이 거부한다:
#   fatal: cannot remove a locked working tree, lock reason: claude agent ...
# 즉 --force 를 쓰지 않는 한 실행 중인 작업을 구조적으로 건드릴 수 없다.
# 더러운 트리(미커밋 변경)도 같은 이유로 git 이 막는다. 이 두 거부가 자동화를
# 사람 판단 없이 돌려도 되게 만드는 유일한 근거이므로, --force 를 넣지 않는다.
#
# ── 왜 미머지 브랜치를 자동으로 지우지 않는가 ───────────────────────────────
# 2026-09-20 에 73커밋짜리 미머지 worktree(2.9G)가 있었고 아무도 그 존재를
# 몰랐다. 큰 쪽이 위험한 쪽이므로, 크기와 커밋 수를 출력만 하고 판단은 사람에게
# 남긴다. "안 지워서 낭비되는 디스크" 보다 "지워서 사라지는 73커밋" 이 비싸다.
#
# ── 왜 DRY_RUN 기본값이 prune-images.sh 와 반대인가 ─────────────────────────
# prune-images.sh 는 DRY_RUN=1 을 명시해야 예행한다(기본 실행). 이 스크립트는
# 반대로 기본이 예행이고 DRY_RUN=0 을 명시해야 지운다. 지우는 대상이 이미지가
# 아니라 사람의 작업 디렉터리이고, 오판의 복구 비용이 재빌드가 아니라 재작업
# 이기 때문이다. hook 으로 자동 실행할 때만 DRY_RUN=0 을 명시한다.
#
# ── 실행 ────────────────────────────────────────────────────────────────────
#   make worktree-gc              # 예행 — 무엇을 지울지 보여만 준다
#   make worktree-gc DRY_RUN=0    # 실제 제거
#
# SCOPE 로 자동 제거 대상 경로를 한정한다(기본 .claude/worktrees). 이 밖에 직접
# 만든 worktree 는 목록에만 나오고 절대 제거되지 않는다 — 자동화가 사용자가
# 손으로 만든 것을 지우면 안 된다.

# set -e 를 쓰지 않는다. worktree 하나의 판정이 실패해도 나머지를 끝까지 본다.
# (prune-images.sh·ops-check.sh 와 같은 이유)
set -uo pipefail

DRY_RUN="${DRY_RUN:-1}"
BASE_REF="${BASE_REF:-origin/main}"
SCOPE="${SCOPE:-.claude/worktrees}"

log() { printf '%s\n' "$*"; }

# ── 중복 실행 방지 ──────────────────────────────────────────────────────────
# 병렬 세션이 동시에 시작하면 GC 가 겹친다. macOS 기본 bash 에는 flock 이 없어
# mkdir 의 원자성을 쓴다. 죽은 프로세스의 잠금은 10분 뒤 회수한다.
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  log "❌ git 저장소가 아닙니다"; exit 1
}
cd "$REPO_ROOT" || exit 1
LOCK_DIR="$REPO_ROOT/.git/worktree-gc.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then
    log "⚠️  10분 이상 된 잠금을 회수합니다: $LOCK_DIR"
    rmdir "$LOCK_DIR" 2>/dev/null
    mkdir "$LOCK_DIR" 2>/dev/null || { log "❌ 잠금 획득 실패"; exit 1; }
  else
    log "⏭️  다른 worktree-gc 가 실행 중입니다 — 건너뜁니다"
    exit 0
  fi
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT

# ── 기준 ref 최신화 ─────────────────────────────────────────────────────────
# 머지 판정이 낡은 origin/main 을 보면 방금 머지한 것을 미머지로 오판한다.
# 네트워크 실패는 치명적이지 않다 — 그 경우 보수적으로(=덜 지우는 쪽으로) 간다.
git fetch -q origin 2>/dev/null || log "⚠️  fetch 실패 — 캐시된 $BASE_REF 로 판정합니다"

if ! git rev-parse --verify -q "$BASE_REF" >/dev/null; then
  log "❌ 기준 ref 를 찾을 수 없습니다: $BASE_REF"; exit 1
fi

# ── squash 머지 판정에 gh 를 쓸 수 있는가 ───────────────────────────────────
# 한 번만 확인하고 worktree 마다 재확인하지 않는다. 없으면 조상 판정만 쓰며,
# 그 경우 squash 로 머지된 브랜치는 "미머지" 로 보존된다(덜 지우는 쪽으로 틀린다).
USE_GH=0
if [ "${NO_GH:-0}" != "1" ] && command -v gh >/dev/null 2>&1 \
   && gh auth status >/dev/null 2>&1; then
  USE_GH=1
else
  log "ℹ️  gh 판정 불가 — 조상 판정만 씁니다 (squash 머지 브랜치는 보존됩니다)"
fi

[ "$DRY_RUN" = "0" ] || log "🔍 예행(DRY_RUN=1) — 실제로 지우려면 DRY_RUN=0"
log ""
printf '%-38s %6s  %s\n' "WORKTREE" "크기" "판정"
printf '%s\n' "---------------------------------------------------------------------"

# 표에 넣을 짧은 이름 — .claude/worktrees/ 접두사는 빼고, 레포 밖은 ../ 로 표시.
# 이름이 길면 앞을 잘라 뒤(구분되는 쪽)를 남긴다.
display_name() {
  local p="$1" n
  case "$p" in
    "$REPO_ROOT/$SCOPE"/*) n="${p#"$REPO_ROOT/$SCOPE"/}" ;;
    "$REPO_ROOT"/*)        n="${p#"$REPO_ROOT"/}" ;;
    *)                     n="../$(basename "$p")" ;;
  esac
  if [ ${#n} -gt 38 ]; then printf '…%s' "${n: -37}"; else printf '%s' "$n"; fi
}

removable=""
reclaim_kb=0
kept_kb=0

# git worktree list --porcelain: 레코드가 빈 줄로 구분된다.
# 메인 worktree(첫 레코드)는 건드리지 않는다 — git 이 거부하기도 한다.
current="" ; branch="" ; locked="" ; first=1
process_record() {
  [ -n "$current" ] || return 0
  if [ "$first" = "1" ]; then first=0; return 0; fi   # 메인 체크아웃

  rel=$(display_name "$current")
  size_kb=$(du -sk "$current" 2>/dev/null | awk '{print $1}')
  size_kb=${size_kb:-0}
  size_h=$(du -sh "$current" 2>/dev/null | awk '{print $1}')
  size_h=${size_h:-?}
  short="${branch#refs/heads/}"
  [ -n "$short" ] || short="(detached)"

  # 1) 실행 중 — git 이 remove 를 거부한다. 목록에만 남긴다.
  if [ -n "$locked" ]; then
    printf '%-38s %6s  🔒 실행 중 (%s)\n' "$rel" "$size_h" "$short"
    kept_kb=$((kept_kb + size_kb)); return 0
  fi

  # 2) 미커밋 변경 — 역시 git 이 막지만, 이유를 먼저 보여 준다.
  if [ -n "$(git -C "$current" status --porcelain 2>/dev/null)" ]; then
    printf '%-38s %6s  ✋ 미커밋 변경 (%s)\n' "$rel" "$size_h" "$short"
    kept_kb=$((kept_kb + size_kb)); return 0
  fi

  # 3) 머지 판정 — 두 경로가 있다.
  #  (a) 조상: 일반 머지. git 만으로 판정된다.
  #  (b) GitHub 기록: squash 머지. PR #300 이 73커밋을 새 커밋 1개로 합쳤고 원본
  #      73개는 main 의 조상이 아니라 (a) 는 영원히 거짓을 낸다. 2026-09-21 에 대안
  #      2개를 실측으로 기각했다 — `git cherry` 는 patch-id 가 N:1 이라 57커밋을
  #      여전히 미검출로 냈고, `git merge-tree` 는 브랜치에 남은 옛 문구 때문에
  #      트리가 "다름" 으로 나왔다. 로컬 git 에 그 연결이 남지 않는 것이 squash 의
  #      본질이므로, 따로 기록해 둔 GitHub 에 묻는 것이 유일하게 맞는 방법이다.
  #      headRefOid 까지 대조하는 이유: PR 머지 뒤 그 브랜치에 커밋을 더 했다면
  #      gh 는 여전히 "머지됨" 이라 답하지만 tip 에는 미머지 작업이 남아 있다.
  merged_reason=""
  if [ "$short" != "(detached)" ]; then
    if git merge-base --is-ancestor "$short" "$BASE_REF" 2>/dev/null; then
      merged_reason="조상"
    elif [ "$USE_GH" = "1" ]; then
      pr=$(gh pr list --state merged --head "$short" --json number,headRefOid \
             --jq '.[] | "\(.number) \(.headRefOid)"' 2>/dev/null | head -1)
      # gh 실패(네트워크·미인증·PR 없음)는 빈 문자열이 되어 "모름 → 보존" 으로
      # 떨어진다. 실패를 "머지됨" 으로 읽지 않는 것이 이 분기의 안전 규칙이다.
      # --state merged 만 본다 — 열린 PR(리뷰 중)은 지우면 안 된다.
      if [ -n "$pr" ] && [ "${pr##* }" = "$(git rev-parse "$short" 2>/dev/null)" ]; then
        merged_reason="PR #${pr%% *}"
      fi
    fi
  fi
  if [ -z "$merged_reason" ]; then
    ahead=$(git rev-list --count "$BASE_REF".."$short" 2>/dev/null || echo "?")
    printf '%-38s %6s  ⚠️  미머지 %s커밋 (%s)\n' "$rel" "$size_h" "$ahead" "$short"
    kept_kb=$((kept_kb + size_kb)); return 0
  fi

  # 4) 범위 밖 — 사용자가 직접 만든 worktree 는 보고만 한다.
  case "$current" in
    "$REPO_ROOT/$SCOPE"/*) ;;
    *) printf '%-38s %6s  ↩︎ %s·범위 밖 보존 (%s)\n' "$rel" "$size_h" "$merged_reason" "$short"
       kept_kb=$((kept_kb + size_kb)); return 0 ;;
  esac

  # 5) 제거 대상
  printf '%-38s %6s  ✅ %s — 제거 대상 (%s)\n' "$rel" "$size_h" "$merged_reason" "$short"
  removable="${removable}${current}"$'\n'
  reclaim_kb=$((reclaim_kb + size_kb))
}

while IFS= read -r line; do
  case "$line" in
    "worktree "*) current="${line#worktree }" ;;
    "branch "*)   branch="${line#branch }" ;;
    "locked"*)    locked="yes" ;;
    "")           process_record; current="" ; branch="" ; locked="" ;;
  esac
done < <(git worktree list --porcelain; echo)

log ""
log "회수 가능: $(awk -v k="$reclaim_kb" 'BEGIN{printf "%.2f GB", k/1024/1024}')   보존: $(awk -v k="$kept_kb" 'BEGIN{printf "%.2f GB", k/1024/1024}')"

if [ -z "$removable" ]; then
  log "제거할 worktree 가 없습니다."
  git worktree prune
  exit 0
fi

if [ "$DRY_RUN" != "0" ]; then
  log ""
  log "예행이므로 아무것도 지우지 않았습니다. 실행: make worktree-gc DRY_RUN=0"
  exit 0
fi

log ""
printf '%s' "$removable" | while IFS= read -r wt; do
  [ -n "$wt" ] || continue
  # --force 를 쓰지 않는다. 판정 이후 상태가 바뀌었으면 git 이 막아야 한다.
  if git worktree remove "$wt" 2>/dev/null; then
    log "🗑️  제거: ${wt#"$REPO_ROOT"/}"
  else
    log "⏭️  건너뜀(git 이 거부): ${wt#"$REPO_ROOT"/}"
  fi
done

# 수동 삭제된 디렉터리의 잔여 메타데이터 정리. 디스크는 비우지 않는다.
git worktree prune
log ""
log "완료. 브랜치는 남겨 둡니다 — 필요하면 git branch -d 로 지우세요."
