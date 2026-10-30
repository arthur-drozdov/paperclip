// SDK compatibility: issue create/update currently expose actor attribution fields.
// A worker-supplied ID is not authenticated delegation. Reject these fields
// until a host-issued, scoped delegation contract exists; do not impersonate.
const common = [
  "actorAgentId", "actorUserId", "actorRunId", "actorRunStopId",
  "actorPrincipalType", "actorResponsibleUserId", "trustExplicitResponsibleUserId",
  "createdByAgentId", "createdByUserId", "originRunId", "watchdogActorRunId",
  "checkoutRunId", "executionRunId", "originIdentityContextId", "continuationIdentityContextId",
] as const;

export function rejectPluginIssueActorClaims(
  input: Record<string, unknown>,
  operation: "create" | "update",
): void {
  const forbidden: readonly string[] = operation === "update"
    ? [...common, "companyId", "companyGuard", "expectedExecutionPolicy"]
    : common;
  for (const key of forbidden) {
    if (input[key] !== undefined && input[key] !== null) {
      throw new Error(`Plugin-supplied ${key} is not authenticated; trusted delegation is unavailable`);
    }
  }
}

export function stripPluginIssueUpdateOverrides(input: Record<string, unknown>): Record<string, unknown> {
  const result = { ...input };
  for (const key of [...common, "companyId", "companyGuard", "expectedExecutionPolicy"]) delete result[key];
  return result;
}
