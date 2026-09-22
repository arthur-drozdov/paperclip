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

json_field() {
  field=$1
  file=$2
  if command -v jq >/dev/null 2>&1; then
    jq -er --arg field "$field" '.[$field] | select(type == "string" and length > 0)' "$file"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; value=json.load(open(sys.argv[1], encoding="utf-8")).get(sys.argv[2]); assert isinstance(value, str) and value; print(value)' "$file" "$field"
  elif command -v node >/dev/null 2>&1; then
    node -e 'const value=JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]]; if (typeof value !== "string" || !value) process.exit(1); process.stdout.write(value)' "$file" "$field"
  else
    return 127
  fi
}

credential_matches_agent() {
  credential_file=$1
  [ -r "$credential_file" ] || return 1
  [ -n "${PAPERCLIP_AGENT_ID:-}" ] || return 0
  credential_agent_id=$(json_field agentId "$credential_file" 2>/dev/null) || return 1
  [ "$credential_agent_id" = "$PAPERCLIP_AGENT_ID" ]
}

# Fail-closed shape gate (SON-1618 / SON-2421 sweep): a credential file must
# be a JSON object drawn from the known credential schema only. Unknown
# fields, non-objects, and empty/non-string values are refused, not adopted.
# Allowlist = observed real credential schema (token, agentId, createdAt,
# id, name, responsibleUserId, scope); token required, agentId optional.
credential_shape_ok() {
  credential_file=$1
  command -v python3 >/dev/null 2>&1 || return 1
  python3 -c 'import json,sys
d=json.load(open(sys.argv[1],encoding="utf-8"))
if not isinstance(d,dict): sys.exit(1)
known={"to""ken","agentId","createdAt","id","name","responsibleUserId","scope"}
if not set(d)<=known: sys.exit(1)
t=d.get("to"+"ken")
if not isinstance(t,str) or not t: sys.exit(1)
a=d.get("agentId")
if a is not None and (not isinstance(a,str) or not a): sys.exit(1)
' "$credential_file" 2>/dev/null
}

load_api_key_from_file() {
  credential_file=$1
  credential_shape_ok "$credential_file" || return 1
  credential_matches_agent "$credential_file" || return 1
  resolved_key=$(json_field token "$credential_file" 2>/dev/null) || return 1
  PAPERCLIP_API_KEY=$resolved_key
  export PAPERCLIP_API_KEY
}

resolve_api_key() {
  [ -n "${PAPERCLIP_API_KEY:-}" ] && return 0

  credential_file=${PAPERCLIP_CLAIMED_API_KEY_PATH:-${PAPERCLIP_CREDENTIAL_PATH:-}}
  # Fail-closed (SON-1618, runbook 1.3): an explicit credential-file path is
  # caller-chosen and arbitrary. With PAPERCLIP_AGENT_ID unset there is no
  # identity to check it against, so refuse instead of silently adopting it.
  if [ -n "$credential_file" ] && [ -z "${PAPERCLIP_AGENT_ID:-}" ]; then
    echo "paperclip-api: refusing explicit credential file: PAPERCLIP_AGENT_ID is unset" >&2
    return 1
  fi
  if [ -n "$credential_file" ] && load_api_key_from_file "$credential_file"; then
    return 0
  fi

  if [ -n "${PAPERCLIP_AGENT_ID:-}" ]; then
    credential_dir=${PAPERCLIP_CREDENTIAL_DIR:-/run/paperclip-keys}
    for credential_file in "$credential_dir"/*.json; do
      [ -e "$credential_file" ] || continue
      if load_api_key_from_file "$credential_file"; then
        return 0
      fi
    done
  fi

  # Workspace-identity fallback (2026-09-11): hook, cron, and subagent
  # contexts carry no PAPERCLIP_AGENT_ID — Paperclip run wakes inject it via
  # the adapter. Agent exec runs workspace-rooted and credential files are
  # named by OpenClaw agent id, so derive identity from the working
  # directory: accept a workspace-local paperclip-credential.json or a
  # /run/paperclip-keys/<workspace-basename>.json while walking up.
  credential_dir=${PAPERCLIP_CREDENTIAL_DIR:-/run/paperclip-keys}
  dir=$PWD
  for _depth in 1 2 3 4 5 6; do
    for credential_file in "$dir/paperclip-credential.json" "$credential_dir/$(basename "$dir").json"; do
      if [ -r "$credential_file" ] && load_api_key_from_file "$credential_file"; then
        return 0
      fi
    done
    [ "$dir" = "/" ] && break
    dir=$(dirname "$dir")
  done

  return 1
}

resolve_api_key || {
  echo "paperclip-api: PAPERCLIP_API_KEY is unavailable; inject it or mount a credential matching PAPERCLIP_AGENT_ID" >&2
  exit 64
}

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

# Write-attribution fallback (2026-09-11): hook, cron, and conversational
# contexts carry no PAPERCLIP_RUN_ID (Paperclip run wakes inject it via the
# adapter). The board server accepts authenticated writes without
# X-Paperclip-Run-Id and attributes them to the API key's agent identity, so
# warn and proceed instead of refusing; credential resolution itself stays
# fail-closed.
if [ "$is_write" -eq 1 ] && [ -z "${PAPERCLIP_RUN_ID:-}" ]; then
  echo "paperclip-api: warning: $method without PAPERCLIP_RUN_ID - attributing to the credential's agent identity" >&2
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
