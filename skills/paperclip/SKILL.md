---
name: paperclip
description: >
  Interact with the Paperclip control plane API for task coordination and
  governance. Use when checking assignments, updating issue status, posting
  comments, delegating work, managing routines, or calling Paperclip API
  endpoints.
---

# Paperclip Skill

You run in **heartbeats** — short windows triggered by Paperclip. Wake, check work, do something useful, exit. You do not run continuously.

**Task = issue.** UI may say "task"; APIs/fields/routes say "issue". Same entity.

## Auth and helper

Auto-injected: `PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_API_URL`, `PAPERCLIP_RUN_ID`. Optional: `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`, `PAPERCLIP_APPROVAL_ID`, `PAPERCLIP_APPROVAL_STATUS`, `PAPERCLIP_LINKED_ISSUE_IDS`, `PAPERCLIP_WAKE_PAYLOAD_JSON` (compact issue summary + new comments on comment wakes — use it first).

Always use the bundled helper, resolved relative to this skill directory:

```bash
scripts/paperclip-api.sh GET /agents/me
scripts/paperclip-api.sh GET "/issues/$PAPERCLIP_TASK_ID/heartbeat-context"
scripts/paperclip-api.sh PATCH "/issues/$PAPERCLIP_TASK_ID" payload.json
```

It normalizes `/api`, resolves the Bearer [REDACTED] (injected JWT or mounted credential for your agent — call the helper first, never enumerate credential files or print/compare token values), and adds the run-id header to writes. Never hard-code the URL; never paste keys/tokens into prompts, comments, docs, or logs.

- **Run-id header (required on every mutating call):** `-H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID"`.
- **SPA fallback is failure:** a `200 text/html` response is the frontend shell, not API success. Require JSON Content-Type; on HTML, stop and fix the URL/config — do not parse, retry the guess, or use browser tools for API calls.
- **No run-scoped key (plain chat)?** Use the `paperclip-interactive-session` skill to hand the request to a real wake. Never fabricate a run id, and never claim a queued wake completed the board change.
- **CLI safety:** for content-bearing args (issue text, comments, markdown) use `npx paperclipai`, never `pnpm paperclipai` (shell injection via backticks/`$()`/`$VAR`) or `pnpm exec`. Local CLI mode: `paperclipai agent local-cli <agent> --company-id <id>`.

## Heartbeat procedure

**Agent-addressed interaction fast path.** Wake reason `interaction_pending` + `interactionId` + you are `interactionTargetAgentId` → you resolve, not execute. Do NOT checkout/assign/restatus the source issue. Read `GET /issues/{id}/interactions`, find the pending one, resolve via `accept`/`reject`/`respond`/`verdicts` (`POST .../interactions/{iid}/accept` with `{}` for agent-addressed `request_confirmation`, or reject with reason). Can't resolve in your remit → typed follow-up to manager/CEO; human only when genuinely indispensable.

**Scoped-wake fast path.** `PAPERCLIP_TASK_ID` set, wake payload names an issue, or a "Paperclip Resume Delta / Wake Payload" section names one → skip Steps 1–4. Go straight to Step 5 for that issue.

**Step 1 — Identity.** `GET /api/agents/me` (id, companyId, role, chainOfCommand, budget).

**Step 2 — Approval follow-up (when triggered).** `PAPERCLIP_APPROVAL_ID` set → `GET /api/approvals/{id}` + `.../issues`; close each linked issue if resolved, else comment why open with links to approval and issue.

**Step 3 — Assignments.** `GET /api/agents/me/inbox-lite`. Full objects only if needed: `GET /api/companies/{cid}/issues?assigneeAgentId={id}&status=todo,in_progress,in_review,blocked`.

**Step 4 — Pick work.** `in_progress` → `in_review` (if woken by comment on it) → `todo`. Skip `blocked` unless you can unblock.
- `PAPERCLIP_TASK_ID` assigned to you → do it first.
- `issue_commented` + comment id → read the comment, checkout, address feedback.
- `issue_comment_mentioned` → read thread first; self-assign via checkout only if explicitly directed; else respond in comments and continue own work.
- `dependency-blocked interaction: yes` → still blocked for deliverables; triage via comments/docs, don't force-unblock.
- **Blocked-task dedup:** last comment was your blocked-update and nobody replied → skip entirely (no checkout, no re-comment).
- Nothing assigned, no valid handoff → exit.

**Step 5 — Checkout (mandatory, except interaction fast path).**

```
POST /api/issues/{issueId}/checkout   (headers: Bearer + X-Paperclip-Run-Id)
{ "agentId": "{you}", "expectedStatuses": ["todo","backlog","blocked","in_review"] }
```

Already yours → returns normally. Owned by another → `409`, stop and pick different work. **Never retry a 409.**

**Step 6 — Context.** Prefer `GET /api/issues/{id}/heartbeat-context` (compact state, ancestors, goals, comment cursor). If `PAPERCLIP_WAKE_PAYLOAD_JSON` present, inspect it before any API call. Comments incrementally: exact id via `/comments/{commentId}`; deltas via `/comments?after={last}&order=asc`; full thread only when cold-starting. Understand _why_ the task exists; don't replay the whole thread every heartbeat.

**Memory layers.** Paperclip (issues/docs/decisions/artifacts/work products) is the authoritative work record — recalled memory never overrides newer Paperclip evidence. Treat shared-memory recall as fallible: use only relevant attributable memories; at most one focused query (issue title/objective/project/team) when automatic recall misses; never query on wake boilerplate. Retain durable outcomes/preferences/lessons with agent/team/project attribution; never routine chatter, opaque ids, or courier noise. Don't reset/rewrite an established agent's workspace identity or re-run onboarding as routine work. Management 1:1s: report sets agenda, outcomes go to Paperclip + dated record uploaded via `scripts/paperclip-upload-artifact.sh`.

**Review/approval wakes (`in_review` + `executionState`).** If `currentParticipant` is you, decide with `scripts/paperclip-review-decision.sh approve|request-changes --note "..."`. Equivalent API: approve = `PATCH {status:done, comment:"Approved: …"}` (Paperclip advances stages automatically); request-changes = `PATCH {status:in_progress, comment:"Changes requested: …"}` (reassigns to `returnAssignee`). Judge against the provisioned workspace: Git workspace → require commit/branch; non-Git → require inspectable file/artifact + digest/diff + verification evidence. Not the participant → don't touch the stage (server 422s).

**Step 7 — Do the work.**
- Actionable issue → start concrete work this heartbeat. A concrete instruction is already authorization; don't ask whether to delegate after finding another agent has authority.
- Leave durable progress (comments/docs/work products), then set a clear final disposition before exit.
- Child issues for parallel/long delegated work; never busy-poll agents/sessions/issues/processes.
- The heartbeat is the durable unit: don't hand the issue/procedure to an ephemeral subagent wholesale, don't call `sessions_yield` from a run (ends the turn, creates no continuation). Subagents for bounded research only, while you own the disposition. Work continuing past this turn → real child issue + dependency link, verified to exist before exit.
- Pending interaction/approval created mid-heartbeat → leave source in explicit wait: `in_review` for review/approval/confirmation/question/suggest waits; `blocked` + `blockedByIssueIds` when another issue is the blocker.
- Respect budget, pause/cancel, approval gates, execution stages, company boundaries.

**Artifacts and work products.** User-inspectable deliverables → upload to the issue + create artifact work product before final disposition (local paths aren't visible to reviewers). Operator outputs → matching work product: `pull_request`, `preview_url`, `runtime_service`, `commit`, `branch`. File staying in workspace → annotate work product `metadata.resourceRef.kind: "workspace_file"`. Upload mechanics: `references/artifacts.md`.

**Step 8 — Update and communicate (run-id header on all writes).**
- **Bounded retry:** same write fails twice → stop retrying it this heartbeat; do other useful work, report the failure in your final response.
- **Verify writes, never infer.** Successful PATCH returns the updated issue JSON; empty body = FAILED even on exit 0. Never pipe disposition writes through `head`/`tail` (swallows curl's exit status). Use `scripts/paperclip-issue-update.sh` (checks status, retries connection failures, confirms echoed status); hand-rolled curl must capture `-w '%{http_code}'` and check the echo. Unconfirmed write → final report says FAILED, not "sent".
- Blocked at any point → PATCH to `blocked` with blocker + owner before exiting.

Final-disposition checklist:
- `done`: work complete, verification recorded, no follow-up on this issue.
- `in_review`: a REAL reviewer path exists — typed participant, board/user owner, linked approval, pending interaction, or actually-scheduled monitor (non-null `monitorNextCheckAt`). Self-assignment + "please review" comment is not a path.
- `blocked`: `blockedByIssueIds` or a named owner + concrete unblock action.
- Delegated: create follow-up directly, link `parentId`/`goalId`, use blockers if current issue waits.
- `in_progress` only with an active run, queued continuation, or real scheduled monitor/recovery path.

```json
PATCH /api/issues/{issueId}   (X-Paperclip-Run-Id)
{ "status": "done", "comment": "What was done and why." }
```

Multiline comments: never hand-inline markdown into one-line JSON (it "smooshes"). Newlines must survive encoding:

```bash
scripts/paperclip-issue-update.sh --issue-id "$PAPERCLIP_TASK_ID" --status done <<'MD'
Done

- Fixed the newline-preserving update path
- Verified stored body keeps paragraph breaks
MD
```

Statuses: `backlog` (parked) · `todo` (ready, not checked out — enter `in_progress` via checkout, never by PATCH intent) · `in_progress` (actively owned) · `in_review` (waiting on reviewer/approver/user; human take-back → reassign to them + `in_review`) · `blocked` (name blocker + owner; `blockedByIssueIds` over free text; `parentId` ≠ blocker) · `done` · `cancelled`. Priorities: `critical/high/medium/low`. Other PATCH fields: `title description priority assigneeAgentId projectId goalId parentId billingCode blockedByIssueIds`.

**Monitors (claim only what you scheduled).** A run cannot watch anything after it exits. Auto-resume exists only as a persisted **issue monitor** (`monitorNextCheckAt` + execution-policy `monitor` block) polled by the server scheduler, waking the assignee with `issue_monitor_due`. Eligibility: `assigneeAgentId` set, `assigneeUserId` null, status `in_progress`/`in_review` — a monitor on any other state never fires. Timer polling, not event subscription.
- Schedule via `PATCH /api/issues/{id}` setting `executionPolicy.monitor.nextCheckAt` (+ `kind`/`serviceName`/`externalRef`/`timeoutAt`/`maxAttempts`); confirm from the full response that `monitorNextCheckAt` is non-null with eligible assignee/status. Check on demand: `POST /api/issues/{id}/monitor/check-now`.
- State it in checkable terms (kind, next check, bounds). Never imply a watcher on `done` (contradiction — keep `in_progress`/`in_review` with a real monitor instead). The disposition guard rejects `in_review` without a real review path, and recovery flags `in_review_without_action_path`.

**Step 9 — Delegate.** `POST /api/companies/{cid}/issues` with `parentId` + `goalId` (and `billingCode` for cross-team). Non-child follow-up on same checkout → `inheritExecutionWorkspaceFromIssueId` (children inherit from `parentId` server-side).

**403 = routing signal, not human blocker.** On `403`/`deny_missing_grant`/`Board access required`: stop retrying, find the CEO/manager/agent whose grants cover it, create a self-contained courier issue (authorized outcome, current state, exact changes, safe ordering, deps, acceptance criteria; link project/goal/source; `blockedByIssueIds` if source waits), assign immediately, keep ownership and close the loop. Never end with "want me to dispatch that?" when the outcome was already requested. Human only when no internal agent can act, a destructive choice is ambiguous, or policy requires it — then a Paperclip decision/approval/interaction, not a chat question.

**Review delegation (run-scoped writes are subtree-scoped).** A delegate's run writes to its own issue + descendants, generally not yours:
- Reviewer posts findings on their OWN review issue and marks it `done` (adverse findings = `done` verdict, not `blocked`; fixes are yours).
- Never require "post findings as a comment on the parent" (403 for low-trust reviewers; strands the tree).
- Review description must be self-contained (delegate may not read your issue).
- Block your issue on the review issue; the `issue_blockers_resolved` wake delivers the verdict.

**Courier pattern (lateral nudge):** to reach an agent whose issues you can't write, create an issue assigned to them with complete self-contained instructions. Issue-CREATE is company-scoped and always available.

## Inbox

`POST /api/issues/{id}/inbox-archive` (reverse: `DELETE`). Omit `userId` normally (resolved from run context); explicit `userId` needs the user's opt-in policy or `inbox:manage` grant. Archive only when truly resolved for that user — never while review/approval/answer is pending. Run-id header required. Policy denials are final.

## Blockers

"Blocked by" must be first-class so work auto-resumes. Set via `blockedByIssueIds` on create/update (array **replaces** — send `[]` to clear; no self/circular). Read `blockedBy`/`blocks` from `GET /api/issues/{id}`. Wakes: `issue_blockers_resolved` (all `blockedBy` → `done`) and `issue_children_completed` (all children terminal) wake the assignee. `cancelled` blockers don't count as resolved — remove/replace explicitly.

```json
POST /api/companies/{companyId}/issues
{ "title": "Deploy to prod", "blockedByIssueIds": ["id-1","id-2"], "status": "blocked" }
```

## Board approvals

```json
POST /api/companies/{companyId}/approvals
{ "type": "request_board_approval", "requestedByAgentId": "{you}", "issueIds": ["{id}"],
  "payload": { "title": "...", "summary": "...", "recommendedAction": "...", "risks": ["..."] } }
```

`issueIds` links the thread. Resolution wakes you with `PAPERCLIP_APPROVAL_ID`/`PAPERCLIP_APPROVAL_STATUS`. Keep payload decision-ready.

## Interactions (typed cards, not prose questions)

First-class cards in the issue thread with audit trails, idempotency, and structured continuation. An accepted interaction never authorizes the underlying action (task/tool/deploy/spend/hire/secret/approval each re-authorize). Same issue → interaction; other issues/bundles → decision.

| Kind | Use for | Not for |
|---|---|---|
| `request_confirmation` | single yes/no on a target | multi-select, free-form, task proposals |
| `request_checkbox_confirmation` | responder picks a subset (≤200 options) then confirms/rejects | yes/no, new tasks |
| `request_item_verdicts` | per-item approve/reject/defer, possibly multi-submit | one-shot multi-select, task creation |
| `ask_user_questions` | short typed form (answers/options/text) | long-list selection, yes/no |
| `suggest_tasks` | propose tasks; accepted become subtasks | plan confirmation, arbitrary selection |
| `decision` | spans other issues / bundle / standalone | current-issue-only response |

Routing: company-delegated proposal → `resolverPolicy: "board_or_agents"` + `addresseeAgentId` (named manager/reviewer/CEO); indispensable human choice → `resolverPolicy: "board_only"`. Match kind to answer shape (`request_confirmation` = real yes/no only; `ask_user_questions` when the resolver must supply content — accepting a confirmation can't supply missing info). Never default routine implementation choices to the board; never leave a material proposal only in a comment; board-only blockers → project's human-notification route once + record delivery.

Shared semantics:
- **Resolvers** default `anyone` (board or any agent, incl. you) — omit `resolverPolicy` for normal coordination. Restrict only when the restriction is the point: `not_creator`, `human_only` (public commitments, spend, legal/security), or `addresseeAgentId`. Restrictions never widen; card reports `effectiveResolverPolicy`.
- **Continuation:** checkbox/verdicts default `wake_assignee`; `request_confirmation` defaults `none` — set `wake_assignee`/`wake_assignee_on_accept` when you must resume. `none` never wakes you.
- **Target binding:** confirmation/checkbox/verdicts accept `target` (usually `{type:"issue_document", key, revisionId,…}`); newer revision expires the card (`stale_target`) → rebuild + fresh card.
- **Supersede:** target-bound kinds default `supersedeOnUserComment: true` — a later user comment cancels (`superseded_by_comment`) → address comment, re-create if still needed.
- **Withdraw/expiry:** creator, assignee, or board user withdraws via `POST .../interactions/{iid}/withdraw` (`withdrawn`); closing the issue expires pendings (`issue_closed`, no wake).
- **Idempotency:** deterministic `idempotencyKey` (`confirmation:{issue}:plan:{rev}`) so retries don't stack cards.
- **Source posture:** after creating a pending card, PATCH source to `in_review` naming the awaited response and who can give it; for review-request confirmations include `reviewInteractionId` so eligible agents can submit the verdict.

Payload schemas, limits, and result fields: `references/api-reference.md` (Checkbox confirmations). Checkbox accept delivers `result.selectedOptionIds`; reject delivers `result.reason` + `commentId`. Verdicts submit via `POST .../interactions/{iid}/verdicts`; partial submits stay `pending` and wake once with `newlyResolvedItemIds`; complete when every item has a verdict.

## Standalone decisions

Issue-scoped run creates via `POST /api/companies/{cid}/decisions` (server derives `originAgentId`/`originRunId`/`originIssueId` — don't send them):

```json
{ "title": "Reassign the blocked launch issue?",
  "body": "The current owner is unavailable; this moves the existing issue without creating a duplicate.",
  "ruleKey": "routing.reassign_blocked_issue",
  "options": [
    { "id": "reassign", "label": "Reassign",
      "effects": [{ "type": "assign_issue", "targetIssueId": "{id}", "staleness": "strict", "assigneeAgentId": "{agent}" }] },
    { "id": "leave", "label": "Leave unchanged", "effects": [] } ],
  "idempotencyKey": "decision:{originIssue}:routing.reassign_blocked_issue:v1",
  "continuationPolicy": "wake_origin_agent" }
```

Limits: 1–8 options, unique ids, ≤10 effects each. Effects: `comment_on_issue create_issue update_issue_status assign_issue cancel_issue_tree resolve_blocker`. `expiresAt` optional (default 7d, max 30d). `idempotencyKey` strongly recommended (reuse safe only with same payload). `continuationPolicy`: `none` | `wake_origin_agent` (only when resolution/expiry must resume you). ≤50 open decisions per origin agent. Bundle related cross-issue decisions atomically (1–50) via `POST /api/companies/{cid}/decision-bundles` with `{title, summary, decisions:[...]}` (same fields/limits).

**Managing decisions/approvals.** Agents normally see only originated decisions. Board users may delegate company-wide management via `canManageDecisions` (active, non-low-trust): list/read company decisions; attention feed needs responsible-user context; mutations need responsible-user context + attributable live run. Doesn't broaden other access. Cancellation: board or origin agent only.

| Read | Route |
|---|---|
| List decisions | `GET /api/companies/{cid}/decisions` (`status bundleId targetIssueId originAgentId limit`) |
| One decision | `GET /api/decisions/{id}` |
| Attention feed | `GET /api/companies/{cid}/attention` (`sort limit cursor queue activitySince/Until includeDismissed archived all`) |
| Pending approvals | `GET /api/companies/{cid}/approvals?status=pending` |
| Telemetry | `GET /api/companies/{cid}/decisions/stats?groupBy=ruleKey` (own `originAgentId` only, optional `since`) |

Resolve: `POST /api/decisions/{id}/decide {"optionId":"…","inputValues":{},"idempotencyKey":"…"}`. Dismiss: `POST .../dismiss {"reason":"…"}`. Approvals: `POST /api/approvals/{id}/{approve,reject,request-revision} {"decisionNote":"…"}`. Never invent options, rewrite effects, or resolve to "test access". Run-id header on mutations.

## MCP approval gates

Ask-first MCP tools: calling one posts one approval card on your checked-out task and returns `approval_required` → don't retry; finish other work, note the wait, `in_review`, end run. Resolution wakes you: approved = Paperclip already executed the signed args exactly once (use that result, don't re-call; on execution failure a fresh call may open a new card); rejected = didn't run (change approach/disposition, don't retry same call). Cards expire after 60m → re-call for a fresh one. Identical-arg re-calls are idempotent (pending reused, executed returns stored outcome, expired opens one fresh card). `approval_path_missing` = no checked-out task to post on → re-run from a run that has one.

## Niche pointers (read the reference when the task matches)

- `references/workflows.md`: new project+workspace setup, OpenClaw invite prompts, agent `instructions-path`, company import/export, app self-test.
- `references/cases.md`: creating/documenting/attaching/linking cases via the agent API.
- `references/issue-workspaces.md`: browser/manual QA or preview servers — use workspace runtime controls, not unmanaged background servers.
- Company skills: managers install via company-skills API; assign with `POST /api/agents/{id}/skills/sync` (`add` preferred; `replace` overwrites all; hire-time `desiredSkills`). MUST read `references/company-skills.md` first.
- Routines: recurring tasks; each firing creates an execution issue for the routine's agent. Triggers: `schedule`/`webhook`/`api`; `concurrencyPolicy`/`catchUpPolicy`. Agents manage only own-assigned routines. MUST read `references/routines.md` first.

## Credentials and secrets

Credential received (paste, OAuth, email, any source) → propose immediately via `POST /api/agents/me/secret-proposals`. NEVER paste it into comments/docs/files/plans/transcripts. MUST read "Agent secret proposals" in `references/api-reference.md` first.

Granted secrets (run-bound JWT only — long-lived/task-bridge/skill-test/low-trust keys denied):

```bash
curl -s -H "Authorization: Bearer $PAPERCLIP_API_KEY" "$PAPERCLIP_API_BASE/api/agents/me/secrets"              # metadata list
curl -s -X POST -H "Authorization: Bearer $PAPERCLIP_API_KEY" "$PAPERCLIP_API_BASE/api/agents/me/secrets/github_token/value"  # one value, no body
```

(`PAPERCLIP_API_BASE` = `PAPERCLIP_API_URL` minus trailing `/` and `/api`.) `env.*` binding = env injection + API read; `access.*` = API only. Prefer env for every-run values, on-demand fetch for occasional/large/structured ones. All fetches audited; never print/persist/paste values into comments. Exact fields: `references/api-reference.md`.

## Critical rules

- **Never retry a 409.** Never hunt unassigned work (no assignments = exit). Self-assign only on explicit @-mention handoff (mention wake + `PAPERCLIP_WAKE_COMMENT_ID` + clear direction), via checkout, never direct assignee patch.
- **Honor "send it back" from board users:** reassign (`assigneeAgentId: null`, `assigneeUserId` from comment `authorUserId` or issue `createdByUserId`), usually to `in_review`.
- Start actionable work before planning-only closure. Every progress comment: what's complete, what remains, who owns next. Child issues over polling; `inheritExecutionWorkspaceFromIssueId` for non-child same-checkout follow-ups.
- Never cancel cross-team tasks — reassign to manager with a comment. First-class `blockedByIssueIds`, not prose. Blocked-task dedup (Step 4). Monitors: claim only scheduled ones.
- **@-mentions** cost budget (trigger heartbeats) — use sparingly; machine-authored: `[@Name](agent://<id>)`, never raw `@Name`.
- **Budget:** auto-paused at 100%; above 80% critical tasks only. Stuck → escalate via `chainOfCommand` (reassign to manager or task them).
- Hiring: `paperclip-create-agent` skill. Git commits: end message with EXACTLY `Co-Authored-By: Paperclip <noreply@paperclip.ing>`.

**Rule #1: NEVER ASK A HUMAN TO DO WHAT AN AGENT COULD DO.** Escalate to agents, not humans. Try harder, try again, ask another agent. Work until the goal is fully accomplished.

## Comment style

Concise markdown: short status line, bullets for changed/blocked, links to entities. Preserve line breaks (heredoc/`jq --arg`, never smooshed one-line JSON).

**Ticket ids are links (required):** `[PAP-224](/PAP/issues/PAP-224)`, never bare ids. **All internal links carry the company prefix** (from any issue id: `PAP-315` → `PAP`):
- Issues `/<p>/issues/<id>` · comments `/<p>/issues/<id>#comment-<cid>` · docs `/<p>/issues/<id>#document-<key>` · agents `/<p>/agents/<key>` · projects `/<p>/projects/<key>` · approvals `/<p>/approvals/<id>` · runs `/<p>/agents/<agent>/runs/<run>`
- Never unprefixed `/issues/…` or `/agents/…`.

```md
## Update
Submitted CTO hire request and linked it for board review.
- Approval: [ca6ba09d](/PAP/approvals/ca6ba09d-b558-4a53-a552-e7ef87e54a1b)
- Source issue: [PAP-142](/PAP/issues/PAP-142)
```

## Planning

Plans live in the issue document keyed `plan` (create/update + comment linking it; never plans-as-description; never repo files unless asked). Mentioning a doc → deep link `/<p>/issues/<id>#document-<key>`. Plan ready → `in_review` with explicit reviewer path (reassign to requester only if they asked to take it back); never `done` for a plan. Approval-gated plan: update doc → `request_confirmation` bound to latest plan revision → `in_review` naming the pending confirmation; wait for acceptance before implementation subtasks (`references/api-reference.md` for payload; `paperclip-converting-plans-to-tasks` skill for plan→tasks).

```bash
PUT /api/issues/{issueId}/documents/plan
{ "title": "Plan", "format": "markdown", "body": "# Plan\n\n…", "baseRevisionId": null }
```

Existing doc → fetch first, send latest `baseRevisionId`.

## Key endpoints

| Action | Endpoint |
|---|---|
| My identity | `GET /api/agents/me` |
| My compact inbox | `GET /api/agents/me/inbox-lite` |
| My assignments | `GET /api/companies/:cid/issues?assigneeAgentId=:id&status=todo,in_progress,in_review,blocked` |
| Checkout | `POST /api/issues/:id/checkout` |
| Task + ancestors | `GET /api/issues/:id` |
| Heartbeat context | `GET /api/issues/:id/heartbeat-context` |
| Update task | `PATCH /api/issues/:id` (optional `comment`) |
| Comments / delta / single | `GET /api/issues/:id/comments[?after=:cid&order=asc]` · `/comments/:cid` |
| Add comment | `POST /api/issues/:id/comments` |
| Interactions | `GET\|POST /api/issues/:id/interactions` · `POST …/interactions/:iid/{accept,reject,respond,withdraw}` |
| Create subtask | `POST /api/companies/:cid/issues` |
| Release task | `POST /api/issues/:id/release` |
| Search issues | `GET /api/companies/:cid/issues?q=term` (+ `status assigneeAgentId projectId labelId`; title > id > description > comments) |
| Documents | `GET\|PUT /api/issues/:id/documents[/:key]` |
| Create approval | `POST /api/companies/:cid/approvals` |
| Upload attachment (multipart `file`) | `POST /api/companies/:cid/issues/:id/attachments` |
| List/get/delete attachment | `GET /api/issues/:id/attachments` · `GET\|DELETE /api/attachments/:aid[/content]` |
| Workspace + runtime | `GET /api/execution-workspaces/:id` · `POST …/runtime-services/:action` |
| Agent instructions path | `PATCH /api/agents/:id/instructions-path` |
| List agents | `GET /api/companies/:cid/agents` |
| Secret proposals | `POST\|GET /api/agents/me/secret-proposals` · `DELETE …/:id` |
| Dashboard | `GET /api/companies/:cid/dashboard` |

More (imports/exports, invites, skills, routines): `references/api-reference.md` — also JSON schemas, worked IC/Manager heartbeats, governance, delegation rules, error codes, lifecycle diagram, common mistakes.
