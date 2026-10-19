#!/bin/sh
set -eu
DEPOT_ROOT=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd)
exec /bin/sh "$DEPOT_ROOT/install.sh" "$@"
