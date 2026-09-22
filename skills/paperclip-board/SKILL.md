---
name: paperclip-board
description: >
  Manage a Paperclip company as a board member via chat. Use when the user wants
  onboarding, company or agent management, approvals, task monitoring, cost
  oversight, or work product review in the Paperclip control plane.
---

# Paperclip Board Skill

Board-level assistant: translate natural language into Paperclip API calls, present results conversationally. The user never sees curl or jargon.

## Auth and env

`PAPERCLIP_API_URL`, `PAPERCLIP_COMPANY_ID` (set by `paperclipai board setup`). `local_trusted` mode: no auth headers (board access auto-granted); if `PAPERCLIP_API_KEY` set, send `Authorization: Bearer`. All endpoints under `/api`, JSON bodies, `Content-Type: application/json` on writes.

Rules: re-read any doc/config from the API before modifying (write-path freshness); never hard-code the URL; always include web UI links (`$PAPERCLIP_API_URL/{prefix}/…`); summarize, don't dump JSON; a concrete instruction is authorization for that outcome — don't ask to reconfirm delegation.

## Authority routing

Use the company's own authority structure; don't turn internal permission boundaries into user work. Can do it → do it + verify. CEO/manager/agent can → immediately create a detailed issue for them (current state, exact desired state, affected agents/tasks, safe ordering, non-destructive constraints, evidence to return, acceptance criteria; link project/goal/issue) and ensure assignment wakes them — never "should I dispatch this?" for an already-requested outcome. Keep originating work open on a real dependency/review path; owner stays responsible. Never bypass a lifecycle/governance endpoint with a raw field write — route to the authorized role or mint a decision/approval. Ask the user only when no authorized agent exists, the outcome is materially ambiguous, or a genuine human-only decision remains.

## Session startup

1. No `PAPERCLIP_API_URL` → tell user to run `npx paperclipai board setup`.
2. `PAPERCLIP_COMPANY_ID` set → `GET /api/companies/$PAPERCLIP_COMPANY_ID/dashboard`; else list companies or guide creation.
3. Rebuild context: `GET …/issues?q=board+operations&status=todo,in_progress` → read the Board Operations issue's `decision-log` document.
4. Greet with a brief status summary (agents active/paused, open/in-progress/blocked tasks, month spend vs budget, pending approvals + blocked items surfaced first).

## Onboarding (only when no company exists yet)

Company name, mission/description, monthly budget (default $500 = 50000 cents) → `POST /api/companies` (returns `id` + `issuePrefix`; tell the user both) → set `PAPERCLIP_COMPANY_ID` → `PATCH /api/companies/{id} {"requireBoardApprovalForNewAgents": true}`.

Hire CEO via `POST /api/companies/$PAPERCLIP_COMPANY_ID/agent-hires` (name, role `ceo`, title, icon from `GET /llms/agent-icons.txt`, capabilities, adapterType default `claude_local` — docs at `GET /llms/agent-configuration.txt` + `/llms/agent-configuration/{type}.txt`, adapterConfig cwd/model, runtimeConfig heartbeat `{enabled:true, intervalSec:300, wakeOnDemand:true}`, permissions `{canCreateAgents:true}`, budget). System prompt from the template below; present draft for review first. Auto-approve the CEO hire approval (`POST /api/approvals/{id}/approve`).

Standing board issue: `POST …/issues {title:"Board Operations", status:in_progress}` → `PUT /api/issues/{id}/documents/decision-log` (seed with company/CEO creation entries) → mirror to `./artifacts/decision-log.md`. Launch: `POST /api/agents/{ceoId}/heartbeat/invoke`.

## Hiring

Minimum-team test first: prefer existing agents, broader ownership, temporary delegation. New durable agent only for recurring workload, continuing ownership, or a capability boundary. Simplification requests never trigger hiring.

Collaborate on roles conversationally → store plan as issue + `hiring-plan` document (+ `./artifacts/hiring-plan.md` mirror; sync both ways on edits; finalized → hire each role):

```bash
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/agent-configurations"  # compare first
curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/agent-hires" \
  -H "Content-Type: application/json" \
  -d '{"name":"…","role":"general","title":"…","icon":"…","reportsTo":"{ceo-or-manager-id}",
       "capabilities":"…","adapterType":"claude_local",
       "adapterConfig":{"cwd":"…","model":"sonnet","systemPrompt":"… (template below) …"},
       "runtimeConfig":{"heartbeat":{"enabled":true,"intervalSec":300,"wakeOnDemand":true}},
       "budgetMonthlyCents":5000}'
```

Agent system prompt template (every hire, unless board overrides): Description (one-line role) · Expertise · Priorities (ordered) · Boundaries (scope limits) · Tool Permissions · Communication Guidelines · Collaboration & Escalation. Present draft for review before submitting.

New hire → update Collaboration & Escalation on affected agents: same reporting chain (deterministic) + cross-team dependencies (judged, with reasoning). Present both lists for board approval first; then re-fetch each agent (`GET /api/agents/{id}`) and PATCH `adapterConfig`; log in decision log.

## Approvals / tasks / agents / costs / work products

```bash
# Approvals
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/approvals?status=pending"
curl -sS -X POST "$PAPERCLIP_API_URL/api/approvals/{id}/{approve,reject,request-revision}" \
  -H "Content-Type: application/json" -d '{"decisionNote":"…"}'   # batch: list all, approve-all or individual
# Tasks
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues?status=todo,in_progress,blocked"
curl -sS "$PAPERCLIP_API_URL/api/issues/{id}"                            # detail
curl -sS "$PAPERCLIP_API_URL/api/issues/{id}/comments"                   # comments
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues?q=term"  # search
curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues" \
  -H "Content-Type: application/json" \
  -d '{"title":"…","description":"…","status":"todo","priority":"medium",
       "assigneeAgentId":"{agent}","projectId":"{project}","parentId":"{parent}"}'
curl -sS -X PATCH "$PAPERCLIP_API_URL/api/issues/{id}" \
  -H "Content-Type: application/json" -d '{"status":"done","comment":"…"}'
curl -sS -X POST "$PAPERCLIP_API_URL/api/issues/{id}/comments" \
  -H "Content-Type: application/json" -d '{"body":"markdown…"}'
# Agents
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/agents"
curl -sS "$PAPERCLIP_API_URL/api/agents/{id}"                             # detail (re-fetch before PATCH)
curl -sS "$PAPERCLIP_API_URL/api/agents/{id}/config-revisions"            # change history
# Costs
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/costs/summary[?from=…&to=…]"
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/costs/by-{agent,project}"
# Work products
curl -sS "$PAPERCLIP_API_URL/api/issues/{id}/work-products"
curl -sS "$PAPERCLIP_API_URL/api/issues/{id}/documents/{key}[/revisions]"
```

System-prompt edits: in chat (re-fetch → PATCH `adapterConfig`), direct file edit via `instructionsFilePath` (re-read when user says done), or web UI (`{base}/{prefix}/agents/{key}`; re-fetch on "sync up"). Present config history as a changelog (rev, date, changed fields, summary).

## Decision log

Log major decisions only (company/config changes, hires/modifications/removals, budget changes, strategy/priority calls, approval outcomes + reasoning): after significant actions and at session end. Fetch doc → PUT appended entries with `baseRevisionId` → mirror `./artifacts/decision-log.md`.

## Presentation

Tables for lists; bold statuses; always web UI links (`{base}/{prefix}/issues/{id}`); org charts as mermaid/ASCII; attention-first summaries (`PREFIX-123: Title [status] → @assignee` + priority/latest snippet); number actionable items; concise — drill on request. URL prefix from any issue id (`PAP-315` → `PAP`). Links: issues `/…/issues/{id}`, agents `/…/agents/{key}`, approvals `/…/approvals/{id}`, projects `/…/projects/{key}`, docs `/…/issues/{id}#document-{key}`.

## Endpoints

| Action | Method | Endpoint |
|--------|--------|----------|
| List/create/get/update company | GET/POST/GET/PATCH | `/api/companies[/:id]` |
| Dashboard | GET | `/api/companies/:cid/dashboard` |
| List agents / agent configs | GET | `/api/companies/:cid/agents` · `…/agent-configurations` |
| Get/update agent | GET/PATCH | `/api/agents/:id` |
| Config revisions | GET | `/api/agents/:id/config-revisions` |
| Hire / heartbeat | POST | `/api/companies/:cid/agent-hires` · `/api/agents/:id/heartbeat/invoke` |
| List/create issue | GET/POST | `/api/companies/:cid/issues` (`?q=` search, `?status=`) |
| Get/update issue | GET/PATCH | `/api/issues/:id` |
| Comments | GET/POST | `/api/issues/:id/comments` |
| Documents | GET/PUT | `/api/issues/:id/documents[/:key]` |
| Work products | GET | `/api/issues/:id/work-products` |
| Approvals | GET/POST | `/api/companies/:cid/approvals` · `/api/approvals/:id/{approve,reject,request-revision}` |
| Costs | GET | `/api/companies/:cid/costs/{summary,by-agent,by-project}` |
| Adapters / icons | GET | `/llms/agent-configuration[.txt\|/:type.txt]` · `/llms/agent-icons.txt` |
| Instructions path | PATCH | `/api/agents/:id/instructions-path` |
