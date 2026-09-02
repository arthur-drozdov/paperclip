import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";

vi.mock("@paperclipai/adapter-utils/execution-target", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runAdapterExecutionTargetProcess: vi.fn() };
});

import { ensureRemoteOpenCodeModelConfiguredAndAvailable, execute } from "./execute.js";
import { runAdapterExecutionTargetProcess } from "@paperclipai/adapter-utils/execution-target";

const runProcessMock = vi.mocked(runAdapterExecutionTargetProcess);

async function createSkillDir(root: string, name: string): Promise<string> {
  const skillDir = path.join(root, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), `# ${name}\n`, "utf8");
  return skillDir;
}

function probeResult(overrides: Record<string, unknown>) {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    pid: 123,
    startedAt: new Date().toISOString(),
    ...overrides,
  } as never;
}

describe("OpenCode local skill injection", () => {
  it("injects runtime skills into the configured child HOME", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-configured-home-"));
    const processHome = path.join(root, "process-home");
    const configuredHome = path.join(root, "configured-home");
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "opencode");
    const skillSource = await createSkillDir(path.join(root, "runtime-skills"), "paperclip");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(commandPath, "#!/bin/sh\nexit 0\n", "utf8");
    await fs.chmod(commandPath, 0o755);

    const previousHome = process.env.HOME;
    process.env.HOME = processHome;
    runProcessMock.mockReset();
    runProcessMock.mockResolvedValueOnce(probeResult({
      stdout: JSON.stringify({
        type: "text",
        sessionID: "session-configured-home",
        part: { text: "done" },
      }),
    }));

    try {
      const result = await execute({
        runId: "run-configured-home",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "OpenCode Coder",
          adapterType: "opencode_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          model: "openai/gpt-5",
          env: {
            HOME: configuredHome,
            OPENCODE_ALLOW_ALL_MODELS: "1",
          },
          paperclipRuntimeSkills: [{
            key: "paperclipai/paperclip/paperclip",
            runtimeName: "paperclip",
            source: skillSource,
          }],
          promptTemplate: "Follow the paperclip heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);
      const installedSkill = path.join(configuredHome, ".claude", "skills", "paperclip");
      expect((await fs.lstat(installedSkill)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(installedSkill)).toBe(await fs.realpath(skillSource));
      await expect(fs.lstat(path.join(processHome, ".claude", "skills", "paperclip"))).rejects.toThrow();
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("ensureRemoteOpenCodeModelConfiguredAndAvailable", () => {
  afterEach(() => {
    delete process.env.OPENCODE_ALLOW_ALL_MODELS;
  });

  // The remote/sandbox execution path must honour OPENCODE_ALLOW_ALL_MODELS just
  // like the local path: gateway-routed models (e.g. anthropic/<gateway>/<model>
  // via Bifrost) never appear in `opencode models`, so the availability probe
  // must be skipped. The early return happens before the executionTarget is ever
  // touched, so a bogus target proves the probe was not run.
  const bogusTarget = {} as never;

  it("skips the remote availability probe when OPENCODE_ALLOW_ALL_MODELS is set in the run env", async () => {
    await expect(
      ensureRemoteOpenCodeModelConfiguredAndAvailable({
        runId: "run-1",
        executionTarget: bogusTarget,
        command: "opencode",
        model: "anthropic/tensorix/deepseek/deepseek-chat-v3.1",
        cwd: "/tmp",
        env: { OPENCODE_ALLOW_ALL_MODELS: "true" },
        timeoutSec: 30,
        graceSec: 5,
      }),
    ).resolves.toBeUndefined();
  });

  it("honours OPENCODE_ALLOW_ALL_MODELS from the process env", async () => {
    process.env.OPENCODE_ALLOW_ALL_MODELS = "1";
    await expect(
      ensureRemoteOpenCodeModelConfiguredAndAvailable({
        runId: "run-2",
        executionTarget: bogusTarget,
        command: "opencode",
        model: "anthropic/tensorix/deepseek/deepseek-chat-v3.1",
        cwd: "/tmp",
        env: {},
        timeoutSec: 30,
        graceSec: 5,
      }),
    ).resolves.toBeUndefined();
  });

  it("still enforces provider/model format even when the bypass flag is set", async () => {
    await expect(
      ensureRemoteOpenCodeModelConfiguredAndAvailable({
        runId: "run-3",
        executionTarget: bogusTarget,
        command: "opencode",
        model: "",
        cwd: "/tmp",
        env: { OPENCODE_ALLOW_ALL_MODELS: "true" },
        timeoutSec: 30,
        graceSec: 5,
      }),
    ).rejects.toThrow();
  });
});

describe("opencode_local minimalEnvironment", () => {
  // This suite runs a real fake-opencode child process, so it needs the real
  // spawner rather than the file-level vi.mock used by the remote-probe suites.
  beforeEach(async () => {
    const actual = (await vi.importActual("@paperclipai/adapter-utils/execution-target")) as Record<
      string,
      unknown
    >;
    runProcessMock.mockImplementation(actual.runAdapterExecutionTargetProcess as never);
  });
  afterEach(() => {
    runProcessMock.mockReset();
  });

  it("removes ambient server authority while retaining run identity and configured safe env", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-minimal-execute-"));
    const command = path.join(root, "fake-opencode.cjs");
    const capturePath = path.join(root, "captured-run-env.json");
    const keys = [
      "HOME",
      "XDG_CONFIG_HOME",
      "CODEX_HOME",
      "DATABASE_URL",
      "OPENAI_API_KEY",
      "PAPERCLIP_AGENT_JWT_SECRET",
      "PAPERCLIP_SECRETS_MASTER_KEY",
      "PAPERCLIP_SIGNING_SECRET",
      "BETTER_AUTH_SECRET",
      "PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN",
      "PAPERCLIP_API_KEY",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "HINDSIGHT_API_TOKEN",
    ] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    Object.assign(process.env, {
      HOME: "/paperclip/server-home",
      XDG_CONFIG_HOME: "/paperclip/server-config",
      CODEX_HOME: "/paperclip/server-codex",
      DATABASE_URL: "postgres://server-only",
      OPENAI_API_KEY: "server-openai-key",
      PAPERCLIP_AGENT_JWT_SECRET: "server-jwt",
      PAPERCLIP_SECRETS_MASTER_KEY: "server-master",
      PAPERCLIP_SIGNING_SECRET: "server-signing",
      BETTER_AUTH_SECRET: "server-auth",
      PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN: "server-cloud",
      PAPERCLIP_API_KEY: "server-api",
      AWS_ACCESS_KEY_ID: "server-aws-access",
      AWS_SECRET_ACCESS_KEY: "server-aws-secret",
      AWS_SESSION_TOKEN: "server-aws-session",
      HINDSIGHT_API_TOKEN: "server-memory",
    });

    try {
      await writeFile(
        command,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          "const args = process.argv.slice(2);",
          "if (args[0] === 'models') {",
          "  process.stdout.write('deepseek-local/deepseek-v4-flash\\n');",
          "  process.exit(0);",
          "}",
          "fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({",
          "  home: process.env.HOME ?? null,",
          "  xdgConfig: process.env.XDG_CONFIG_HOME ?? null,",
          "  codexHome: process.env.CODEX_HOME ?? null,",
          "  databaseUrl: process.env.DATABASE_URL ?? null,",
          "  openAiKey: process.env.OPENAI_API_KEY ?? null,",
          "  jwt: process.env.PAPERCLIP_AGENT_JWT_SECRET ?? null,",
          "  master: process.env.PAPERCLIP_SECRETS_MASTER_KEY ?? null,",
          "  signing: process.env.PAPERCLIP_SIGNING_SECRET ?? null,",
          "  auth: process.env.BETTER_AUTH_SECRET ?? null,",
          "  cloud: process.env.PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN ?? null,",
          "  serverApi: process.env.PAPERCLIP_API_KEY ?? null,",
          "  awsAccess: process.env.AWS_ACCESS_KEY_ID ?? null,",
          "  awsSecret: process.env.AWS_SECRET_ACCESS_KEY ?? null,",
          "  awsSession: process.env.AWS_SESSION_TOKEN ?? null,",
          "  memory: process.env.HINDSIGHT_API_TOKEN ?? null,",
          "  hasPath: Boolean(process.env.PATH),",
          "  paperclipAgentId: process.env.PAPERCLIP_AGENT_ID ?? null,",
          "  paperclipApiUrl: process.env.PAPERCLIP_API_URL ?? null,",
          "  paperclipRunId: process.env.PAPERCLIP_RUN_ID ?? null,",
          "  explicitValue: process.env.EXPLICIT_NON_SECRET ?? null",
          "}));",
          "process.stdout.write(JSON.stringify({ type: 'step_start', sessionID: 'minimal-session' }) + '\\n');",
          "process.stdout.write(JSON.stringify({ type: 'text', sessionID: 'minimal-session', part: { text: 'ok' } }) + '\\n');",
          "process.stdout.write(JSON.stringify({ type: 'step_finish', sessionID: 'minimal-session', part: { cost: 0, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } } }) + '\\n');",
        ].join("\n"),
        "utf8",
      );
      await chmod(command, 0o755);

      const result = await execute({
        runId: "minimal-env-run",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Local worker",
          adapterType: "opencode_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command,
          cwd: root,
          model: "deepseek-local/deepseek-v4-flash",
          variant: "max",
          dangerouslySkipPermissions: false,
          minimalEnvironment: true,
          env: {
            CAPTURE_PATH: capturePath,
            EXPLICIT_NON_SECRET: "configured",
          },
        },
        context: {
          paperclipWorkspace: { cwd: root, source: "project_primary" },
        },
        authToken: "task-scoped-paperclip-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);
      expect(result.summary).toBe("ok");
      const captured = JSON.parse(await readFile(capturePath, "utf8")) as Record<string, unknown>;
      expect(captured).toMatchObject({
        codexHome: null,
        databaseUrl: null,
        openAiKey: null,
        jwt: null,
        master: null,
        signing: null,
        auth: null,
        cloud: null,
        serverApi: "task-scoped-paperclip-token",
        awsAccess: null,
        awsSecret: null,
        awsSession: null,
        memory: null,
        hasPath: true,
        paperclipAgentId: "agent-1",
        paperclipApiUrl: expect.stringMatching(/^http:\/\//),
        paperclipRunId: "minimal-env-run",
        explicitValue: "configured",
      });
      expect(captured.home).not.toBe("/paperclip/server-home");
      expect(captured.xdgConfig).not.toBe("/paperclip/server-config");
    } finally {
      for (const key of keys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("ensureRemoteOpenCodeModelConfiguredAndAvailable — probe is non-fatal when it cannot run", () => {
  const target = { kind: "remote", transport: "ssh" } as never;
  const base = {
    runId: "run-probe",
    executionTarget: target,
    command: "opencode",
    cwd: "/tmp",
    env: {} as Record<string, string>,
    timeoutSec: 30,
    graceSec: 5,
  };

  beforeEach(() => {
    runProcessMock.mockReset();
  });

  it("proceeds when the remote probe exits non-zero (e.g. a transient `Unexpected error`)", async () => {
    runProcessMock.mockResolvedValueOnce(probeResult({ exitCode: 1, stderr: "Unexpected error" }));
    await expect(
      ensureRemoteOpenCodeModelConfiguredAndAvailable({ ...base, model: "openai/gpt-5" }),
    ).resolves.toBeUndefined();
  });

  it("proceeds when the remote probe times out", async () => {
    runProcessMock.mockResolvedValueOnce(probeResult({ timedOut: true, exitCode: null }));
    await expect(
      ensureRemoteOpenCodeModelConfiguredAndAvailable({ ...base, model: "openai/gpt-5" }),
    ).resolves.toBeUndefined();
  });

  it("proceeds when the remote probe returns no models", async () => {
    runProcessMock.mockResolvedValueOnce(probeResult({ exitCode: 0, stdout: "" }));
    await expect(
      ensureRemoteOpenCodeModelConfiguredAndAvailable({ ...base, model: "openai/gpt-5" }),
    ).resolves.toBeUndefined();
  });

  it("still rejects when the probe succeeds but the configured model is absent (guard retained)", async () => {
    runProcessMock.mockResolvedValueOnce(probeResult({ exitCode: 0, stdout: "openai/gpt-4.1\n" }));
    await expect(
      ensureRemoteOpenCodeModelConfiguredAndAvailable({ ...base, model: "openai/gpt-5" }),
    ).rejects.toThrow("Configured OpenCode model is unavailable on the remote execution target");
  });
});
