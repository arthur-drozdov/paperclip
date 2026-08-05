import { describe, expect, it } from "vitest";
import { listOpenClawGatewaySkills } from "./skills.js";

describe("OpenClaw gateway skill status", () => {
  it("reports declared skills as externally managed without claiming installation", async () => {
    const snapshot = await listOpenClawGatewaySkills({
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "openclaw_gateway",
      config: {
        paperclipSkillSync: {
          desiredSkills: [
            "paperclipai/paperclip/paperclip",
            {
              key: "paperclipai/paperclip/paperclip-board",
              versionId: "22222222-2222-4222-8222-222222222222",
            },
          ],
        },
      },
    });

    expect(snapshot).toMatchObject({
      adapterType: "openclaw_gateway",
      supported: false,
      mode: "external",
      desiredSkills: [
        "paperclipai/paperclip/paperclip",
        "paperclipai/paperclip/paperclip-board",
      ],
    });
    expect(snapshot.entries).toEqual([
      expect.objectContaining({
        key: "paperclipai/paperclip/paperclip",
        runtimeName: "paperclip",
        desired: true,
        managed: false,
        readOnly: true,
        state: "external",
      }),
      expect.objectContaining({
        key: "paperclipai/paperclip/paperclip-board",
        runtimeName: "paperclip-board",
        versionId: "22222222-2222-4222-8222-222222222222",
        desired: true,
        managed: false,
        readOnly: true,
        state: "external",
      }),
    ]);
    expect(snapshot.warnings.join(" ")).toMatch(/installation and runtime verification are managed/i);
  });

  it("returns an empty external snapshot when no skills are declared", async () => {
    const snapshot = await listOpenClawGatewaySkills({
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "openclaw_gateway",
      config: {},
    });

    expect(snapshot.mode).toBe("external");
    expect(snapshot.desiredSkills).toEqual([]);
    expect(snapshot.entries).toEqual([]);
  });
});
