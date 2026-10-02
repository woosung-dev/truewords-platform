#!/usr/bin/env bash
# deploy-sh.test.mjs 전용 가짜 docker. 상태는 $FAKE_STATE 의 파일들이다.
#   images·pullable 줄 = "ref<TAB>image id<TAB>alembic head<TAB>아는 이전 revision(쉼표)", running_<svc> = 실행 중 ref,
#   unhealthy = 교체 후 unhealthy 로 보일 ref 목록, db_head = DB alembic_version.
F="${FAKE_STATE:?}"
printf 'docker %s\n' "$*" >> "$F/calls.log"
lookup() { awk -F'\t' -v r="$1" '$1 == r { print; found = 1 } END { exit !found }' "$F/images"; }
field() { lookup "$1" | head -1 | cut -f"$2"; }
last() { eval "echo \"\${$#}\""; }
envtag() {
  local v="${!1:-}"
  [ -n "$v" ] || v=$(grep "^$1=" .env | tail -1 | cut -d= -f2-)
  echo "$v"
}
ref_of() { echo "ghcr.io/woosung-dev/truewords-$1:$(envtag "$(echo "$1" | tr '[:lower:]' '[:upper:]')_TAG")"; }
case "$1" in
  image)
    case "$2" in
      inspect)
        ref=$(last "$@")
        lookup "$ref" > /dev/null || exit 1
        [ "$3" = "-f" ] && field "$ref" 2
        exit 0 ;;
      ls) exit 0 ;;
    esac ;;
  pull)
    ref=$(last "$@")
    line=$(awk -F'\t' -v r="$ref" '$1 == r' "$F/pullable")
    [ -n "$line" ] || { echo "pull: not found $ref" >&2; exit 1; }
    echo "$line" >> "$F/images"
    exit 0 ;;
  tag)
    line=$(lookup "$2") || exit 1
    printf '%s\t%s\n' "$3" "$(echo "$line" | cut -f2-)" >> "$F/images"
    exit 0 ;;
  run)
    # run --rm --network none --entrypoint <cat|sh> <ref> ...
    args=("$@")
    for ((i = 0; i < ${#args[@]}; i++)); do
      [ "${args[$i]}" = "--entrypoint" ] && { ep="${args[$((i + 1))]}"; ref="${args[$((i + 2))]}"; break; }
    done
    if [ "$ep" = cat ]; then
      field "$ref" 3
      exit 0
    fi
    # image_knows_rev: 마지막 인자 revision 이 이 이미지의 head 이거나 4번째 칸(쉼표 목록)에 있으면 0
    rev=$(last "$@")
    [ "$(field "$ref" 3)" = "$rev" ] && exit 0
    case ",$(field "$ref" 4)," in *",$rev,"*) exit 0 ;; esac
    exit 1 ;;
  inspect)
    svc="${4#cid-}"
    ref=$(cat "$F/running_$svc" 2> /dev/null) || exit 1
    case "$3" in
      *Config.Image*) echo "$ref" ;;
      *State.Health*) if grep -qxF "$ref" "$F/unhealthy" 2> /dev/null; then echo unhealthy; else echo healthy; fi ;;
      *.Image*) field "$ref" 2 ;;
    esac
    exit 0 ;;
  ps | buildx) exit 0 ;;
  compose)
    shift
    [ "$1" = "--env-file" ] && shift 2
    sub="$1"
    shift
    case "$sub" in
      exec)
        if [ "$2" = postgres ]; then
          [ -f "$F/db_fail" ] && exit 1
          cat "$F/db_head"
          exit 0
        fi
        [ -f "$F/http_fail_$2" ] && exit 1
        exit 0 ;;
      run)
        echo "migrate BACKEND_TAG=${BACKEND_TAG:-}" >> "$F/calls.log"
        [ -f "$F/migrate_fail" ] && exit 1
        field "$(ref_of backend)" 3 > "$F/db_head"
        exit 0 ;;
      up)
        svc=$(last "$@")
        ref=$(ref_of "$svc")
        lookup "$ref" > /dev/null || { echo "no such image $ref" >&2; exit 1; }
        echo "$ref" > "$F/running_$svc"
        if grep -qxF "$ref" "$F/unhealthy" 2> /dev/null; then echo "container $svc is unhealthy" >&2; exit 1; fi
        exit 0 ;;
      ps)
        svc=$(last "$@")
        [ -f "$F/running_$svc" ] && echo "cid-$svc"
        exit 0 ;;
    esac ;;
esac
exit 0
