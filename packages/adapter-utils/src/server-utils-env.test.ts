import { describe, expect, it } from "vitest";
import {
  sanitizeInheritedPaperclipEnv,
  sanitizeMinimalInheritedPaperclipEnv,
} from "./server-utils.js";

describe("sanitizeInheritedPaperclipEnv", () => {
  it("drops the host-only Paperclip CLI command pointer", () => {
    expect(sanitizeInheritedPaperclipEnv({
      PAPERCLIPAI_CMD: "node /missing/paperclipai/dist/index.js",
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    })).toEqual({
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    });
  });
});

describe("sanitizeMinimalInheritedPaperclipEnv", () => {
  it("keeps process plumbing while excluding ambient homes and authority", () => {
    expect(sanitizeMinimalInheritedPaperclipEnv({
      PATH: "/usr/local/bin:/usr/bin",
      TMPDIR: "/tmp/runtime",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      SSL_CERT_FILE: "/etc/ssl/cert.pem",
      HOME: "/paperclip/server-home",
      XDG_CONFIG_HOME: "/paperclip/server-config",
      XDG_CACHE_HOME: "/paperclip/server-cache",
      CODEX_HOME: "/paperclip/server-codex",
      OPENAI_API_KEY: "ambient-provider-key",
      DATABASE_URL: "postgres://server-only",
      PAPERCLIP_AGENT_JWT_SECRET: "server-only-jwt",
      PAPERCLIP_SECRETS_MASTER_KEY: "server-only-master",
      PAPERCLIP_SIGNING_SECRET: "server-only-signing",
      BETTER_AUTH_SECRET: "server-only-auth",
      PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN: "server-only-cloud",
      PAPERCLIP_API_KEY: "server-only-api",
      AWS_ACCESS_KEY_ID: "server-only-aws-access",
      AWS_SECRET_ACCESS_KEY: "server-only-aws-secret",
      AWS_SESSION_TOKEN: "server-only-aws-session",
      HINDSIGHT_API_TOKEN: "memory-service-token",
    })).toEqual({
      PATH: "/usr/local/bin:/usr/bin",
      TMPDIR: "/tmp/runtime",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      SSL_CERT_FILE: "/etc/ssl/cert.pem",
    });
  });
});
