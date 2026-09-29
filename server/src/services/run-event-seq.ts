import { eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRunEvents } from "@paperclipai/db";

/**
 * Returns the next persisted sequence for a run. Event writers may already
 * have recorded queue or recovery events before executeRun begins, so a
 * process-local counter starting at 1 is not sufficient.
 */
export async function nextHeartbeatRunEventSeq(db: Db, runId: string): Promise<number> {
  const [row] = await db
    .select({ maxSeq: sql<number | null>`max(${heartbeatRunEvents.seq})` })
    .from(heartbeatRunEvents)
    .where(eq(heartbeatRunEvents.runId, runId));
  return Number(row?.maxSeq ?? 0) + 1;
}
