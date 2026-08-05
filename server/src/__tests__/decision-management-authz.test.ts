import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";

const companyId = "22222222-2222-4222-8222-222222222222";
const agentId = "11111111-1111-4111-8111-111111111111";

const getById = vi.hoisted(() => vi.fn());

vi.mock("../services/agents.js", () => ({
  agentService: () => ({ getById }),
}));

const { assertDecisionManager, decisionActor } = await import("../routes/decision-management-authz.js");

function app(actor: Record<string, unknown>) {
  const testApp = express();
  testApp.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  testApp.get("/manage", async (req, res) => {
    await assertDecisionManager({} as never, req, companyId);
    res.json(decisionActor(req));
  });
  testApp.use(errorHandler);
  return testApp;
}

function delegatedActor(overrides: Record<string, unknown> = {}) {
  return {
    type: "agent",
    source: "agent_jwt",
    companyId,
    agentId,
    runId: "33333333-3333-4333-8333-333333333333",
    onBehalfOfUserId: "board-user",
    onBehalfOfMemberships: [{ companyId, membershipRole: "owner", status: "active" }],
    ...overrides,
  };
}

describe("decision management authorization", () => {
  beforeEach(() => {
    getById.mockReset();
    getById.mockResolvedValue({
      id: agentId,
      companyId,
      status: "idle",
      permissions: { canManageDecisions: true },
    });
  });

  it("allows an explicitly delegated, attributable agent run", async () => {
    const response = await request(app(delegatedActor())).get("/manage").expect(200);
    expect(response.body).toMatchObject({
      userId: "board-user",
      agentId,
      runId: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("denies an ordinary agent without explicit decision authority", async () => {
    getById.mockResolvedValue({
      id: agentId,
      companyId,
      status: "idle",
      permissions: { canManageDecisions: false },
    });
    const response = await request(app(delegatedActor())).get("/manage").expect(403);
    expect(response.body.error).toContain("Decision management authority");
  });

  it("denies low-trust agents even if the capability flag is present", async () => {
    getById.mockResolvedValue({
      id: agentId,
      companyId,
      status: "idle",
      permissions: { canManageDecisions: true, trustPreset: "low_trust_review" },
    });
    await request(app(delegatedActor())).get("/manage").expect(403);
  });

  it("requires a live run and responsible board user for delegated writes", async () => {
    await request(app(delegatedActor({ runId: null }))).get("/manage").expect(403);
    await request(app(delegatedActor({ onBehalfOfUserId: null, onBehalfOfMemberships: [] })))
      .get("/manage")
      .expect(403);
  });

  it("preserves local board access", async () => {
    const response = await request(app({
      type: "board",
      source: "local_implicit",
      userId: "board-user",
      companyIds: [companyId],
      isInstanceAdmin: true,
    })).get("/manage").expect(200);
    expect(response.body).toMatchObject({ userId: "board-user", agentId: null });
  });
});
