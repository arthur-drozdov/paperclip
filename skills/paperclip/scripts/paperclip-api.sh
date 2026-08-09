#!/bin/sh
set -eu

usage() {
  echo "usage: paperclip-api.sh METHOD ROUTE [JSON_FILE|-]" >&2
  echo "ROUTE must be relative to the Paperclip API, for example /agents/me." >&2
  exit 64
}

[ "$#" -ge 2 ] && [ "$#" -le 3 ] || usage

method=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')
route=$2
payload=${3:-}

: "${PAPERCLIP_API_URL:?PAPERCLIP_API_URL is required}"
: "${PAPERCLIP_API_KEY:?PAPERCLIP_API_KEY is required}"

case "$route" in
  http://*|https://*)
    echo "paperclip-api: ROUTE must be relative; refusing an absolute URL" >&2
    exit 64
    ;;
esac

api_base=${PAPERCLIP_API_URL%/}
api_base=${api_base%/api}
case "$route" in
  /api) endpoint="$api_base/api" ;;
  /api/*) endpoint="$api_base$route" ;;
  /*) endpoint="$api_base/api$route" ;;
  *) endpoint="$api_base/api/$route" ;;
esac

case "$method" in
  GET|HEAD|OPTIONS) is_write=0 ;;
  POST|PUT|PATCH|DELETE) is_write=1 ;;
  *)
    echo "paperclip-api: unsupported HTTP method: $method" >&2
    exit 64
    ;;
esac

if [ "$is_write" -eq 1 ] && [ -z "${PAPERCLIP_RUN_ID:-}" ]; then
  echo "paperclip-api: $method requires PAPERCLIP_RUN_ID for attribution" >&2
  exit 64
fi

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/paperclip-api.XXXXXX")
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM
headers_file="$tmp_dir/headers"
body_file="$tmp_dir/body"
request_file=

if [ -n "$payload" ]; then
  if [ "$payload" = "-" ]; then
    request_file="$tmp_dir/request.json"
    cat > "$request_file"
  else
    [ -f "$payload" ] || {
      echo "paperclip-api: JSON payload file not found: $payload" >&2
      exit 66
    }
    request_file=$payload
  fi
fi

set -- -sS -X "$method" -D "$headers_file" -o "$body_file" \
  -w '%{http_code}' -H "Authorization: Bearer $PAPERCLIP_API_KEY"
if [ -n "${PAPERCLIP_RUN_ID:-}" ]; then
  set -- "$@" -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID"
fi
if [ -n "$request_file" ]; then
  set -- "$@" -H 'Content-Type: application/json' --data-binary "@$request_file"
fi
set -- "$@" "$endpoint"

set +e
status=$(curl "$@")
curl_status=$?
set -e
if [ "$curl_status" -ne 0 ]; then
  echo "paperclip-api: transport failure for $method $route (curl exit $curl_status)" >&2
  exit "$curl_status"
fi

content_type=$(awk '
  tolower($1) == "content-type:" {
    $1 = "";
    sub(/^[[:space:]]+/, "");
    sub(/\r$/, "");
    value = tolower($0)
  }
  END { print value }
' "$headers_file")

if [ ! -s "$body_file" ]; then
  case "$status" in
    2??) exit 0 ;;
    *)
      echo "paperclip-api: $method $route failed with HTTP $status and an empty response" >&2
      exit 22
      ;;
  esac
fi

case "$content_type" in
  application/json*|application/*+json*) ;;
  *)
    shown_type=${content_type:-missing}
    echo "paperclip-api: expected JSON for $method $route, got HTTP $status Content-Type $shown_type" >&2
    echo "paperclip-api: this usually means the frontend SPA was reached; use PAPERCLIP_API_URL with the bundled helper and do not retry a guessed path" >&2
    exit 65
    ;;
esac

if command -v jq >/dev/null 2>&1; then
  jq -e . "$body_file" >/dev/null
elif command -v python3 >/dev/null 2>&1; then
  python3 -c 'import json,sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$body_file"
elif command -v node >/dev/null 2>&1; then
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$body_file"
fi

case "$status" in
  2??) cat "$body_file" ;;
  *)
    echo "paperclip-api: $method $route failed with HTTP $status" >&2
    cat "$body_file" >&2
    exit 22
    ;;
esac
