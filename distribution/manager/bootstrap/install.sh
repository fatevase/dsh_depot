#!/bin/sh
set -eu
DEPOT_ROOT=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd)
if [ -f "$DEPOT_ROOT/runtime/node" ]; then
  DEPOT_NODE="$DEPOT_ROOT/runtime/node"
  DEPOT_EXPECTED=$(cat "$DEPOT_ROOT/runtime/node.sha256")
  if command -v sha256sum >/dev/null 2>&1; then
    DEPOT_ACTUAL=$(sha256sum "$DEPOT_NODE")
  elif command -v shasum >/dev/null 2>&1; then
    DEPOT_ACTUAL=$(shasum -a 256 "$DEPOT_NODE")
  else
    printf '%s\n' '缺少系统 SHA256 工具，无法检查 Node。' >&2; exit 2
  fi
  DEPOT_ACTUAL=${DEPOT_ACTUAL%% *}
  if [ "$DEPOT_EXPECTED" != "$DEPOT_ACTUAL" ]; then
    printf '%s\n' '附带 Node 校验失败，请重新获取安装包。' >&2; exit 2
  fi
else
  DEPOT_NODE=$(command -v node || true)
  if [ -z "$DEPOT_NODE" ]; then
    printf '%s\n' 'RUNTIME_MISSING: 请使用完整包，或安装 Node ^22.19.0 / >=24。' >&2; exit 2
  fi
fi
if [ ! -f "$DEPOT_ROOT/payload.sha256" ]; then
  printf '%s\n' '安装器文件清单缺失，请重新解压。' >&2; exit 2
fi
DEPOT_SEEN='|'
DEPOT_COUNT=0
while IFS= read -r DEPOT_LINE || [ -n "$DEPOT_LINE" ]; do
  DEPOT_HASH=${DEPOT_LINE%% *}
  DEPOT_FILE=${DEPOT_LINE#*  }
  case "$DEPOT_FILE" in core.mjs|manager.tgz|bundle.json) ;; *) printf '%s\n' '安装器文件清单无效。' >&2; exit 2;; esac
  case "$DEPOT_HASH" in *[!a-f0-9]*) exit 2;; esac
  [ "${#DEPOT_HASH}" -eq 64 ] || exit 2
  case "$DEPOT_SEEN" in *"|$DEPOT_FILE|"*) exit 2;; esac
  DEPOT_SEEN="$DEPOT_SEEN$DEPOT_FILE|"
  DEPOT_COUNT=$((DEPOT_COUNT + 1))
  if command -v sha256sum >/dev/null 2>&1; then
    DEPOT_ACTUAL=$(sha256sum "$DEPOT_ROOT/$DEPOT_FILE")
  else
    DEPOT_ACTUAL=$(shasum -a 256 "$DEPOT_ROOT/$DEPOT_FILE")
  fi
  DEPOT_ACTUAL=${DEPOT_ACTUAL%% *}
  if [ "$DEPOT_HASH" != "$DEPOT_ACTUAL" ]; then printf '%s\n' '安装器文件校验失败。' >&2; exit 2; fi
done < "$DEPOT_ROOT/payload.sha256"
[ "$DEPOT_COUNT" -eq 3 ] || exit 2
exec "$DEPOT_NODE" "$DEPOT_ROOT/core.mjs" "$@"
