import type {
  AdapterSkillContext,
  AdapterSkillSnapshot,
} from "@paperclipai/adapter-utils";
import { readPaperclipSkillSyncPreference } from "@paperclipai/adapter-utils/server-utils";

/**
 * OpenClaw owns its workspace and skill installation lifecycle. Paperclip can
 * record the intended skill assignment, but it cannot safely infer runtime
 * installation state through the gateway protocol. Keep that distinction
 * explicit instead of reporting the adapter as generically unsupported.
 */
export async function listOpenClawGatewaySkills(
  ctx: AdapterSkillContext,
): Promise<AdapterSkillSnapshot> {
  const preference = readPaperclipSkillSyncPreference(ctx.config);

  return {
    adapterType: "openclaw_gateway",
    supported: false,
    mode: "external",
    desiredSkills: preference.desiredSkills,
    desiredSkillEntries: preference.desiredSkillEntries,
    entries: preference.desiredSkillEntries.map((entry) => ({
      key: entry.key,
      runtimeName: entry.key.split("/").at(-1) ?? entry.key,
      versionId: entry.versionId,
      desired: true,
      managed: false,
      state: "external",
      origin: "external_unknown",
      originLabel: "OpenClaw deployment",
      locationLabel: "External OpenClaw workspace",
      readOnly: true,
      detail:
        "Declared in Paperclip; installation and runtime verification are managed by the OpenClaw deployment.",
    })),
    warnings: [
      "Skill assignments are declared in Paperclip, but installation and runtime verification are managed by the OpenClaw deployment.",
    ],
  };
}
