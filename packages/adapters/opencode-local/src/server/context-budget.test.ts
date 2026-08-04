import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPENCODE_PROMPT_SAFETY_MARGIN_TOKENS,
  estimateOpenCodePromptTokens,
  fitOpenCodePrompt,
  readOpenCodeModelLimitsFromConfig,
  resolveOpenCodePromptBudget,
} from "./context-budget.js";

describe("OpenCode context budgeting", () => {
  it("reserves output tokens and a safety margin before admitting input", () => {
    const budget = resolveOpenCodePromptBudget({
      contextWindow: 200_000,
      requestedOutputTokens: 32_000,
    });

    expect(budget.maxInputTokens).toBe(200_000 - 32_000 - DEFAULT_OPENCODE_PROMPT_SAFETY_MARGIN_TOKENS);
  });

  it("allows the exact input boundary and compacts one token over it", () => {
    const budget = resolveOpenCodePromptBudget({
      contextWindow: 10,
      requestedOutputTokens: 2,
      safetyMarginTokens: 1,
    });
    const estimateTokens = (text: string) => text.length;

    const exact = fitOpenCodePrompt({
      sections: [{ name: "heartbeat", text: "1234567", priority: 4 }],
      budget,
      estimateTokens,
    });
    expect(exact.trimmed).toBe(false);
    expect(exact.metrics.promptTokenEstimate).toBe(7);
    expect(exact.metrics.promptTokenBudget).toBe(7);

    const over = fitOpenCodePrompt({
      sections: [{ name: "heartbeat", text: "12345678", priority: 4 }],
      budget,
      estimateTokens,
    });
    expect(over.trimmed).toBe(true);
    expect(over.metrics.promptTokenEstimate).toBeLessThanOrEqual(7);
  });

  it("compacts the observed 200k-context boundary failure before provider dispatch", () => {
    const budget = resolveOpenCodePromptBudget({
      contextWindow: 200_000,
      requestedOutputTokens: 32_000,
    });
    const observedInput = "x".repeat(168_001);

    expect(estimateOpenCodePromptTokens(observedInput)).toBe(168_001);
    const fitted = fitOpenCodePrompt({
      sections: [{ name: "heartbeat", text: observedInput, priority: 4 }],
      budget,
    });

    expect(fitted.trimmed).toBe(true);
    expect(fitted.metrics.promptTokenBudget).toBe(166_976);
    expect(fitted.metrics.promptTokenEstimate).toBeLessThanOrEqual(166_976);
  });

  it("compacts lower-priority sections first and produces stable output", () => {
    const input = {
      sections: [
        { name: "instructions", text: "keep-this-instructions", priority: 0 },
        { name: "wake", text: "keep-this-wake", priority: 1 },
        { name: "heartbeat", text: "discard-this-heartbeat-content-0123456789", priority: 4 },
      ],
      budget: resolveOpenCodePromptBudget({
        contextWindow: 50,
        requestedOutputTokens: 5,
        safetyMarginTokens: 1,
      }),
      estimateTokens: (text: string) => text.length,
    };

    const first = fitOpenCodePrompt(input);
    const second = fitOpenCodePrompt(input);
    expect(first.prompt).toBe(second.prompt);
    expect(first.prompt).toContain("keep-this-instructions");
    expect(first.prompt).toContain("keep-this-wake");
    expect(first.metrics.promptTrimmed).toBe(1);
  });

  it("fails clearly when even the compacted prompt cannot fit", () => {
    expect(() =>
      fitOpenCodePrompt({
        sections: [{ name: "instructions", text: "required", priority: 0 }],
        budget: resolveOpenCodePromptBudget({
          contextWindow: 2,
          requestedOutputTokens: 1,
          safetyMarginTokens: 0,
        }),
        estimateTokens: (text: string) => text.length,
      }),
    ).toThrow(/exceeds the model context budget after deterministic compaction/i);
  });

  it("reads current and legacy limit spellings from an OpenCode provider model", () => {
    expect(
      readOpenCodeModelLimitsFromConfig(
        {
          provider: {
            local: {
              models: {
                model: { limit: { context: 200_000, output: 32_000 } },
              },
            },
          },
        },
        "local/model",
      ),
    ).toMatchObject({ contextWindow: 200_000, maxOutputTokens: 32_000 });

    expect(
      readOpenCodeModelLimitsFromConfig(
        {
          provider: {
            local: {
              models: {
                model: { contextWindow: 100_000, maxTokens: 8_192 },
              },
            },
          },
        },
        "local/model",
      ),
    ).toMatchObject({ contextWindow: 100_000, maxOutputTokens: 8_192 });
  });
});
