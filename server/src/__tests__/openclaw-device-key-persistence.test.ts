import { describe, expect, it } from "vitest";
import { ensureGatewayDeviceKey } from "../routes/agents.js";

describe("OpenClaw gateway device identity persistence", () => {
  it("preserves an existing company secret reference on adapter patches", () => {
    const deviceRef = {
      type: "secret_ref",
      secretId: "11111111-1111-1111-1111-111111111111",
      version: "latest",
    };
    const config = {
      url: "ws://openclaw.example.test:18789",
      devicePrivateKeyPem: deviceRef,
      claimedApiKeyPath: "/run/paperclip-keys/agent.json",
    };

    const result = ensureGatewayDeviceKey("openclaw_gateway", config);

    expect(result).toBe(config);
    expect(result.devicePrivateKeyPem).toBe(deviceRef);
  });

  it("creates a key only when device authentication is enabled and no key exists", () => {
    const result = ensureGatewayDeviceKey("openclaw_gateway", {
      url: "ws://openclaw.example.test:18789",
    });

    expect(result.devicePrivateKeyPem).toEqual(expect.stringContaining("BEGIN PRIVATE KEY"));
  });
});
