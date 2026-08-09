import { describe, expect, it } from "vitest";
import {
  buildAgentParams,
  buildWakeText,
  resolveClaimedApiKeyPath,
  resolvePaperclipApiUrlOverride,
  resolveSessionKey,
} from "./execute.js";

const wakePayload = {
  runId: "run-123",
  agentId: "meridian",
  companyId: "company-456",
  taskId: "task-789",
  issueId: "issue-789",
  wakeReason: "assignment",
  wakeCommentId: null,
  approvalId: null,
  approvalStatus: null,
  issueIds: ["issue-789"],
};

describe("resolveSessionKey", () => {
  it("prefixes run-scoped session keys with the configured agent", () => {
    expect(
      resolveSessionKey({
        strategy: "run",
        configuredSessionKey: null,
        agentId: "meridian",
        runId: "run-123",
        issueId: null,
      }),
    ).toBe("agent:meridian:paperclip:run:run-123");
  });

  it("prefixes issue-scoped session keys with the configured agent", () => {
    expect(
      resolveSessionKey({
        strategy: "issue",
        configuredSessionKey: null,
        agentId: "meridian",
        runId: "run-123",
        issueId: "issue-456",
      }),
    ).toBe("agent:meridian:paperclip:issue:issue-456");
  });

  it("prefixes fixed session keys with the configured agent", () => {
    expect(
      resolveSessionKey({
        strategy: "fixed",
        configuredSessionKey: "paperclip",
        agentId: "meridian",
        runId: "run-123",
        issueId: null,
      }),
    ).toBe("agent:meridian:paperclip");
  });

  it("does not double-prefix an already-routed session key", () => {
    expect(
      resolveSessionKey({
        strategy: "fixed",
        configuredSessionKey: "agent:meridian:paperclip",
        agentId: "meridian",
        runId: "run-123",
        issueId: null,
      }),
    ).toBe("agent:meridian:paperclip");
  });
});

describe("buildAgentParams", () => {
  it("strips root-level paperclip fields from gateway agent params", () => {
    expect(
      buildAgentParams({
        payloadTemplate: {
          text: "old text",
          paperclip: { stale: true },
          keep: "value",
        },
        message: "wake text",
        sessionKey: "agent:meridian:paperclip:issue:issue-456",
        runId: "run-123",
        configuredAgentId: "meridian",
        waitTimeoutMs: 30_000,
      }),
    ).toEqual({
      keep: "value",
      message: "wake text",
      sessionKey: "agent:meridian:paperclip:issue:issue-456",
      idempotencyKey: "run-123",
      agentId: "meridian",
      timeout: 30_000,
    });
  });

  it("preserves an explicit agentId and timeout from the payload template", () => {
    expect(
      buildAgentParams({
        payloadTemplate: {
          agentId: "template-agent",
          timeout: 5_000,
        },
        message: "wake text",
        sessionKey: "paperclip",
        runId: "run-123",
        configuredAgentId: "configured-agent",
        waitTimeoutMs: 30_000,
      }),
    ).toEqual({
      agentId: "template-agent",
      timeout: 5_000,
      message: "wake text",
      sessionKey: "paperclip",
      idempotencyKey: "run-123",
    });
  });
});

describe("OpenClaw Paperclip credential hints", () => {
  it("uses the configured claimed API-key path rather than the legacy default", () => {
    expect(resolveClaimedApiKeyPath(" /run/paperclip-keys/sonnia.json ")).toBe(
      "/run/paperclip-keys/sonnia.json",
    );

    const wakeText = buildWakeText(
      wakePayload,
      { PAPERCLIP_API_URL: "http://paperclip.internal:3100" },
      "",
      "/run/paperclip-keys/sonnia.json",
    );

    expect(wakeText).toContain("PAPERCLIP_API_KEY=<token from /run/paperclip-keys/sonnia.json>");
    expect(wakeText).toContain("The values in this wake event are authoritative for this run.");
    expect(wakeText).toContain("Load PAPERCLIP_API_KEY from /run/paperclip-keys/sonnia.json");
    expect(wakeText).not.toContain("~/.openclaw/workspace/paperclip-claimed-api-key.json");
  });

  it("retains the documented default when no path is configured", () => {
    expect(resolveClaimedApiKeyPath(undefined)).toBe("~/.openclaw/workspace/paperclip-claimed-api-key.json");
  });
});

describe("resolvePaperclipApiUrlOverride", () => {
  it("removes trailing slashes before the wake environment is rendered", () => {
    expect(resolvePaperclipApiUrlOverride("http://paperclip.internal:3100/")).toBe(
      "http://paperclip.internal:3100",
    );
    expect(resolvePaperclipApiUrlOverride("https://paperclip.example/base///")).toBe(
      "https://paperclip.example/base",
    );
  });

  it("rejects non-http URLs", () => {
    expect(resolvePaperclipApiUrlOverride("file:///tmp/paperclip")).toBeNull();
  });
});

describe("resolveClaimedApiKeyPath", () => {
  const DEFAULT_PATH = "~/.openclaw/workspace/paperclip-claimed-api-key.json";

  it("returns the configured per-agent path when set", () => {
    expect(
      resolveClaimedApiKeyPath("~/.openclaw/workspace/paperclip-keys/happy.json"),
    ).toBe("~/.openclaw/workspace/paperclip-keys/happy.json");
  });

  it("falls back to the shared default when value is empty", () => {
    expect(resolveClaimedApiKeyPath("")).toBe(DEFAULT_PATH);
    expect(resolveClaimedApiKeyPath("   ")).toBe(DEFAULT_PATH);
  });

  it("falls back to the shared default when value is missing", () => {
    expect(resolveClaimedApiKeyPath(undefined)).toBe(DEFAULT_PATH);
    expect(resolveClaimedApiKeyPath(null)).toBe(DEFAULT_PATH);
  });

  it("falls back to the shared default when value is not a string", () => {
    expect(resolveClaimedApiKeyPath(42)).toBe(DEFAULT_PATH);
    expect(resolveClaimedApiKeyPath({})).toBe(DEFAULT_PATH);
  });
});
