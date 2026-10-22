#!/bin/sh
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)";PK="$HERE/../pkg";RB="$HERE/../../ml-research/route-balance-impl-v1"
CASE="$1";SPEC="$2";LIMIT="${3:-2}";ROOT="$HERE/root-$CASE"
rm -rf "root-$CASE" 2>/dev/null || true
/usr/bin/python3 "$HERE/stage.py" "$ROOT" "$LIMIT" >/dev/null
docker run --rm --network none -e LIMIT="$LIMIT" -v "$PK":/pkg:ro -v "$ROOT":/t -v "$HERE":/h:ro -v "$RB":/rb:ro python:3.12-slim sh -c '
set -e
dpkg -i /rb/.debs-linux-aarch64/libgomp1_14.2.0-19_arm64.deb >/dev/null 2>&1
python -m venv /tmp/venv >/dev/null
/tmp/venv/bin/pip install --quiet --no-index --find-links /rb/.wheels-linux-aarch64 numpy==2.4.4 pyarrow==24.0.0 scipy==1.18.1
/tmp/venv/bin/pip install --quiet --no-index --no-deps --find-links /rb/.wheels-linux-aarch64 xgboost==3.4.1
/tmp/venv/bin/python -B /h/bootstrap.py '"$CASE"' '"$SPEC"'
' 2>&1 | grep "^RESULT_JSON " | sed 's/^RESULT_JSON //'
