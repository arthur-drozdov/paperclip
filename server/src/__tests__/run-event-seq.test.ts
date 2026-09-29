import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  agents,
  companies,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { nextHeartbeatRunEventSeq } from "../services/run-event-seq.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres run-event sequence tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat run-event sequence", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-run-event-seq-");
    db = createDb(tempDb.connectionString);
    await db.execute(sql`
      CREATE UNIQUE INDEX heartbeat_run_events_run_seq_uq
      ON heartbeat_run_events (run_id, seq)
    `);
  }, 20_000);

  afterEach(async () => {
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("continues after an event recorded before execution starts", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "running",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      status: "queued",
    });
    await db.insert(heartbeatRunEvents).values({
      companyId,
      runId,
      agentId,
      seq: 1,
      eventType: "lifecycle",
      stream: "system",
      message: "Queued automatic retry",
    });

    const runStartedSeq = await nextHeartbeatRunEventSeq(db, runId);
    expect(runStartedSeq).toBe(2);
    await db.insert(heartbeatRunEvents).values({
      companyId,
      runId,
      agentId,
      seq: runStartedSeq,
      eventType: "lifecycle",
      stream: "system",
      message: "run started",
    });

    const nextSeq = await nextHeartbeatRunEventSeq(db, runId);
    expect(nextSeq).toBe(3);
    await db.insert(heartbeatRunEvents).values({
      companyId,
      runId,
      agentId,
      seq: nextSeq,
      eventType: "error",
      stream: "system",
      message: "adapter failed",
    });
    const events = await db
      .select({ seq: heartbeatRunEvents.seq })
      .from(heartbeatRunEvents)
      .where(eq(heartbeatRunEvents.runId, runId))
      .orderBy(heartbeatRunEvents.seq);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
  });
});
