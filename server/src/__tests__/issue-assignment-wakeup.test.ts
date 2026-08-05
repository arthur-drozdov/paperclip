import { describe, expect, it, vi } from "vitest";
import { queueIssueAssignmentWakeup } from "../services/issue-assignment-wakeup.js";

const issue = (status: string) => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  assigneeAgentId: "11111111-1111-4111-8111-111111111111",
  status,
});

describe("issue assignment wakeups", () => {
  it.each(["backlog", "blocked"])("does not wake an assignee for %s work", async (status) => {
    const wakeup = vi.fn(async () => undefined);
    const getDependencyReadiness = vi.fn(async () => ({ unresolvedBlockerCount: 0 }));

    await queueIssueAssignmentWakeup({
      heartbeat: { wakeup },
      issue: issue(status),
      reason: "issue_assigned",
      mutation: "create",
      contextSource: "test",
      getDependencyReadiness,
    });

    expect(wakeup).not.toHaveBeenCalled();
    expect(getDependencyReadiness).not.toHaveBeenCalled();
  });

  it("does not wake an assignee while hard dependencies are unresolved", async () => {
    const wakeup = vi.fn(async () => undefined);
    const getDependencyReadiness = vi.fn(async () => ({ unresolvedBlockerCount: 1 }));

    await queueIssueAssignmentWakeup({
      heartbeat: { wakeup },
      issue: issue("todo"),
      reason: "issue_assigned",
      mutation: "create",
      contextSource: "test",
      getDependencyReadiness,
    });

    expect(getDependencyReadiness).toHaveBeenCalledTimes(1);
    expect(wakeup).not.toHaveBeenCalled();
  });

  it("wakes an assignee when todo work is dependency-ready", async () => {
    const wakeup = vi.fn(async () => undefined);
    const getDependencyReadiness = vi.fn(async () => ({ unresolvedBlockerCount: 0 }));

    await queueIssueAssignmentWakeup({
      heartbeat: { wakeup },
      issue: issue("todo"),
      reason: "issue_assigned",
      mutation: "create",
      contextSource: "test",
      getDependencyReadiness,
    });

    expect(wakeup).toHaveBeenCalledWith(
      issue("todo").assigneeAgentId,
      expect.objectContaining({ reason: "issue_assigned" }),
    );
  });

  it("fails closed when dependency readiness cannot be read", async () => {
    const wakeup = vi.fn(async () => undefined);
    const getDependencyReadiness = vi.fn(async () => {
      throw new Error("readiness unavailable");
    });

    await queueIssueAssignmentWakeup({
      heartbeat: { wakeup },
      issue: issue("todo"),
      reason: "issue_assigned",
      mutation: "create",
      contextSource: "test",
      getDependencyReadiness,
    });

    expect(wakeup).not.toHaveBeenCalled();
  });
});
