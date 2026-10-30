import { test } from "node:test";
import assert from "node:assert/strict";
import { rejectPluginIssueActorClaims, stripPluginIssueUpdateOverrides } from "../services/plugin-issue-actor-boundary.ts";

test("rejects worker attribution and internal overrides", () => {
  for (const operation of ["create", "update"]) {
    for (const key of ["actorAgentId", "actorUserId", "actorRunId", "actorRunStopId", "actorPrincipalType", "actorResponsibleUserId", "trustExplicitResponsibleUserId", "createdByAgentId", "createdByUserId", "originRunId", "watchdogActorRunId", "checkoutRunId", "executionRunId", "originIdentityContextId", "continuationIdentityContextId"]) {
      assert.throws(() => rejectPluginIssueActorClaims({ [key]: "forged" }, operation), /not authenticated/);
    }
  }
  for (const key of ["companyId", "companyGuard", "expectedExecutionPolicy"]) {
    assert.throws(() => rejectPluginIssueActorClaims({ [key]: "forged" }, "update"), /not authenticated/);
  }
});

test("preserves ordinary fields and strips null update overrides", () => {
  const patch = { title: "ordinary", actorUserId: null, companyId: null, originRunId: null };
  assert.doesNotThrow(() => rejectPluginIssueActorClaims(patch, "update"));
  assert.deepEqual(stripPluginIssueUpdateOverrides(patch), { title: "ordinary" });
  assert.doesNotThrow(() => rejectPluginIssueActorClaims({ companyId: "tenant", title: "ordinary" }, "create"));
});
