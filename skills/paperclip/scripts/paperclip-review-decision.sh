#!/bin/sh
set -eu

usage() {
  cat >&2 <<'EOF'
usage: paperclip-review-decision.sh approve|request-changes [--issue-id ID] [--note TEXT]

Submit the current execution-stage review decision through Paperclip's normal
issue update route. Defaults to PAPERCLIP_TASK_ID and attributes the write to
PAPERCLIP_RUN_ID through the bundled API helper.
EOF
  exit 64
}

[ "$#" -ge 1 ] || usage
action=$1
shift

issue_id=${PAPERCLIP_TASK_ID:-}
note=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --issue-id)
      [ "$#" -ge 2 ] || usage
      issue_id=$2
      shift 2
      ;;
    --note)
      [ "$#" -ge 2 ] || usage
      note=$2
      shift 2
      ;;
    *) usage ;;
  esac
done

[ -n "$issue_id" ] || {
  echo "paperclip-review-decision: issue id is required (--issue-id or PAPERCLIP_TASK_ID)" >&2
  exit 64
}

case "$action" in
  approve|approved)
    status=done
    prefix=Approved
    [ -n "$note" ] || note="Reviewed and approved."
    ;;
  request-changes|request_changes|changes-requested|changes_requested)
    status=in_progress
    prefix="Changes requested"
    [ -n "$note" ] || {
      echo "paperclip-review-decision: --note is required when requesting changes" >&2
      exit 64
    }
    ;;
  *) usage ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
api_helper=${PAPERCLIP_API_HELPER:-"$script_dir/paperclip-api.sh"}
[ -x "$api_helper" ] || {
  echo "paperclip-review-decision: API helper is not executable: $api_helper" >&2
  exit 69
}

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/paperclip-review-decision.XXXXXX")
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM
payload="$tmp_dir/payload.json"
comment="$prefix: $note"

if command -v jq >/dev/null 2>&1; then
  jq -n --arg status "$status" --arg comment "$comment" \
    '{status: $status, comment: $comment}' > "$payload"
elif command -v python3 >/dev/null 2>&1; then
  python3 -c 'import json,sys; json.dump({"status":sys.argv[1],"comment":sys.argv[2]},sys.stdout)' \
    "$status" "$comment" > "$payload"
elif command -v node >/dev/null 2>&1; then
  node -e 'process.stdout.write(JSON.stringify({status:process.argv[1],comment:process.argv[2]}))' \
    "$status" "$comment" > "$payload"
else
  echo "paperclip-review-decision: jq, python3, or node is required" >&2
  exit 69
fi

exec "$api_helper" PATCH "/issues/$issue_id" "$payload"
