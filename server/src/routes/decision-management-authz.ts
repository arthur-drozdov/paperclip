import type { Request } from "express";
import type { Db } from "@paperclipai/db";
import { forbidden } from "../errors.js";
import { agentService } from "../services/agents.js";
import { assertBoard, assertBoardOrAgent, assertCompanyAccess, getActorInfo } from "./authz.js";

/**
 * Decision authority is an explicit, board-controlled agent capability. It is
 * intentionally separate from ordinary task, queue-triage, and hiring powers.
 */
export async function assertDecisionManager(db: Db, req: Request, companyId: string) {
  assertBoardOrAgent(req);
  assertCompanyAccess(req, companyId);
  if (req.actor.type === "board") {
    assertBoard(req);
    return;
  }

  const actorAgent = req.actor.agentId ? await agentService(db).getById(req.actor.agentId) : null;
  if (
    !actorAgent ||
    actorAgent.companyId !== companyId ||
    actorAgent.status === "terminated" ||
    actorAgent.status === "pending_approval" ||
    actorAgent.permissions?.canManageDecisions !== true ||
    actorAgent.permissions?.trustPreset === "low_trust_review"
  ) {
    throw forbidden("Decision management authority is required");
  }
}

export function decisionActor(req: Parameters<typeof getActorInfo>[0]) {
  const actor = getActorInfo(req);
  if (req.actor.type === "board") {
    return {
      actor,
      userId: req.actor.userId ?? "local-implicit-board",
      agentId: null,
      runId: req.actor.runId ?? null,
      agentApiKeyId: null,
    };
  }
  if (req.actor.type !== "agent" || !req.actor.agentId || !req.actor.runId) {
    throw forbidden("An attributable agent run is required to resolve decisions");
  }
  const userId = req.actor.onBehalfOfUserId?.trim();
  if (!userId) {
    throw forbidden("A responsible board user is required to resolve decisions");
  }
  return {
    actor,
    userId,
    agentId: req.actor.agentId,
    runId: req.actor.runId,
    agentApiKeyId: req.actor.keyId ?? null,
  };
}

export function decisionFeedUserId(req: Request) {
  if (req.actor.type === "board") return req.actor.userId ?? null;
  if (req.actor.type === "agent") return req.actor.onBehalfOfUserId?.trim() || null;
  return null;
}
