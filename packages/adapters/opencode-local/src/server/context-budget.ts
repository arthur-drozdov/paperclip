/**
 * Prompt budgeting for OpenCode runs.
 *
 * OpenCode validates `input tokens + requested output tokens` at the provider
 * boundary.  The adapter cannot use the provider's tokenizer without adding a
 * model-specific dependency, so the default estimator is intentionally
 * conservative.  Callers/tests may provide a stricter estimator when one is
 * available.
 */

export const DEFAULT_OPENCODE_PROMPT_SAFETY_MARGIN_TOKENS = 1_024;
// UTF-8 bytes are a conservative upper bound for tokens: a tokenizer cannot
// emit more tokens than there are input bytes.  This intentionally sacrifices
// some context on ASCII-heavy prompts in exchange for never under-budgeting a
// provider request when a model-specific tokenizer is unavailable.
export const DEFAULT_OPENCODE_ESTIMATED_CHARS_PER_TOKEN = 1;

export type OpenCodePromptSectionName =
  | "instructions"
  | "bootstrap"
  | "wake"
  | "sessionHandoff"
  | "heartbeat";

export interface OpenCodePromptSection {
  name: OpenCodePromptSectionName | string;
  text: string;
  /** Lower values are retained longer when the prompt must be compacted. */
  priority?: number;
  /** Required sections are compacted but never silently omitted. */
  required?: boolean;
}

export interface OpenCodeModelLimits {
  contextWindow: number;
  maxOutputTokens: number;
  source?: string;
}

export interface OpenCodePromptBudget {
  contextWindow: number;
  requestedOutputTokens: number;
  safetyMarginTokens: number;
  maxInputTokens: number;
}

export interface OpenCodePromptMetrics {
  promptTokenEstimate: number;
  promptTokenBudget: number;
  promptContextWindow: number;
  promptOutputTokens: number;
  promptSafetyMarginTokens: number;
  promptTrimmed: number;
  promptTrimmedSections: number;
  promptOmittedSections: number;
}

export interface OpenCodePromptFitResult {
  prompt: string;
  sections: OpenCodePromptSection[];
  metrics: OpenCodePromptMetrics;
  trimmed: boolean;
  omittedSections: string[];
}

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return null;
}

function firstPositive(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = positiveInteger(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function readLimitObject(value: unknown): { contextWindow: number | null; maxOutputTokens: number | null } {
  if (!isRecord(value)) return { contextWindow: null, maxOutputTokens: null };
  const limit = isRecord(value.limit) ? value.limit : {};
  return {
    contextWindow: firstPositive(
      limit.context,
      limit.contextWindow,
      value.contextWindow,
      value.maxContextTokens,
      value.max_model_len,
      value.maxModelLen,
    ),
    maxOutputTokens: firstPositive(
      limit.output,
      limit.maxOutputTokens,
      value.maxTokens,
      value.maxOutputTokens,
      value.max_output_tokens,
      value.maxCompletionTokens,
    ),
  };
}

/**
 * Read limits from a resolved OpenCode config object.  OpenCode has used both
 * `limit.context/output` and the older `contextWindow/maxTokens` spellings;
 * accepting both keeps this adapter compatible with existing configurations.
 */
export function readOpenCodeModelLimitsFromConfig(
  config: unknown,
  modelId: string,
): OpenCodeModelLimits | null {
  if (!isRecord(config)) return null;
  const model = modelId.trim();
  const slash = model.indexOf("/");
  const providerId = slash > 0 ? model.slice(0, slash) : "";
  const providerModelId = slash > 0 ? model.slice(slash + 1) : model;
  const provider = isRecord(config.provider) ? config.provider : {};

  const candidates: Array<{ value: unknown; source: string }> = [
    { value: config, source: "adapter_config" },
  ];

  const providerEntry = providerId && isRecord(provider[providerId]) ? provider[providerId] : null;
  if (providerEntry) {
    candidates.push({ value: providerEntry, source: `provider:${providerId}` });
    const providerModels = isRecord(providerEntry.models) ? providerEntry.models : {};
    const modelEntry = isRecord(providerModels[providerModelId])
      ? providerModels[providerModelId]
      : null;
    if (modelEntry) candidates.unshift({ value: modelEntry, source: `model:${model}` });
  }

  // Some deployments keep adapter limits under a declarative model-limits map
  // rather than in OpenCode's provider object.
  for (const mapKey of ["modelLimits", "models"]) {
    const limitsMap = isRecord(config[mapKey]) ? config[mapKey] : {};
    if (isRecord(limitsMap[model])) {
      candidates.unshift({ value: limitsMap[model], source: `${mapKey}:${model}` });
    }
  }

  let contextWindow: number | null = null;
  let maxOutputTokens: number | null = null;
  let source = "";
  for (const candidate of candidates) {
    const limits = readLimitObject(candidate.value);
    contextWindow ??= limits.contextWindow;
    maxOutputTokens ??= limits.maxOutputTokens;
    if (!source && (limits.contextWindow !== null || limits.maxOutputTokens !== null)) {
      source = candidate.source;
    }
  }

  if (contextWindow === null || maxOutputTokens === null) return null;
  return { contextWindow, maxOutputTokens, source };
}

/** Resolve the usable input budget after reserving output and a guard band. */
export function resolveOpenCodePromptBudget(input: {
  contextWindow: number;
  requestedOutputTokens: number;
  safetyMarginTokens?: number;
}): OpenCodePromptBudget {
  const contextWindow = positiveInteger(input.contextWindow) ?? 0;
  const requestedOutputTokens = positiveInteger(input.requestedOutputTokens) ?? 0;
  const safetyMarginTokens = Math.max(
    0,
    Math.floor(input.safetyMarginTokens ?? DEFAULT_OPENCODE_PROMPT_SAFETY_MARGIN_TOKENS),
  );
  const maxInputTokens = contextWindow - requestedOutputTokens - safetyMarginTokens;
  return {
    contextWindow,
    requestedOutputTokens,
    safetyMarginTokens,
    maxInputTokens,
  };
}

/**
 * Conservative, dependency-free token estimate.  It treats each UTF-8 byte as
 * a possible token.  A provider tokenizer may be supplied to `fitOpenCodePrompt`
 * when exact counting is available.
 */
export function estimateOpenCodePromptTokens(text: string): number {
  if (!text) return 0;
  const bytes = Buffer.byteLength(text, "utf8");
  return Math.ceil(bytes / DEFAULT_OPENCODE_ESTIMATED_CHARS_PER_TOKEN);
}

function joinSections(sections: OpenCodePromptSection[]): string {
  return sections
    .map((section) => section.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function normaliseSections(sections: OpenCodePromptSection[]): OpenCodePromptSection[] {
  return sections
    .map((section, index) => ({
      name: section.name,
      text: typeof section.text === "string" ? section.text : "",
      priority: Number.isFinite(section.priority) ? section.priority : index,
      required: section.required ?? (section.name === "instructions" || section.name === "wake"),
    }))
    .filter((section) => section.text.trim().length > 0);
}

function summariseText(text: string, maxCharacters: number, name: string): string {
  const source = text.trim();
  if (source.length <= maxCharacters) return source;
  const marker = `\n\n[${name} context compacted deterministically; retrieve the full source if needed.]\n\n`;
  if (maxCharacters <= marker.length + 2) return "";
  const available = maxCharacters - marker.length;
  const headLength = Math.ceil(available * 0.6);
  const tailLength = Math.max(0, available - headLength);
  return `${source.slice(0, headLength).trimEnd()}${marker}${source.slice(-tailLength).trimStart()}`.trim();
}

function buildWithCandidate(
  sections: OpenCodePromptSection[],
  index: number,
  maxCharacters: number,
): { prompt: string; section: OpenCodePromptSection } {
  const next = sections.map((section, sectionIndex) =>
    sectionIndex === index
      ? { ...section, text: summariseText(section.text, maxCharacters, section.name) }
      : section,
  );
  return { prompt: joinSections(next), section: next[index]! };
}

/**
 * Fit prompt sections to an input-token budget.  Lower-priority sections are
 * compacted first, retaining deterministic head/tail context and an explicit
 * marker.  If every section must be removed and the marker still cannot fit,
 * an actionable error is thrown before OpenCode is started.
 */
export function fitOpenCodePrompt(input: {
  sections: OpenCodePromptSection[];
  budget: OpenCodePromptBudget;
  estimateTokens?: (text: string) => number;
}): OpenCodePromptFitResult {
  const estimateTokens = input.estimateTokens ?? estimateOpenCodePromptTokens;
  const sections = normaliseSections(input.sections);
  const maxInputTokens = input.budget.maxInputTokens;
  const build = () => joinSections(sections);
  let prompt = build();
  const initialEstimate = estimateTokens(prompt);
  if (maxInputTokens > 0 && initialEstimate <= maxInputTokens) {
    return {
      prompt,
      sections: sections.map((section) => ({ ...section })),
      metrics: {
        promptTokenEstimate: initialEstimate,
        promptTokenBudget: maxInputTokens,
        promptContextWindow: input.budget.contextWindow,
        promptOutputTokens: input.budget.requestedOutputTokens,
        promptSafetyMarginTokens: input.budget.safetyMarginTokens,
        promptTrimmed: 0,
        promptTrimmedSections: 0,
        promptOmittedSections: 0,
      },
      trimmed: false,
      omittedSections: [],
    };
  }

  if (maxInputTokens <= 0) {
    throw new Error(
      `OpenCode model context budget is unusable: context window ${input.budget.contextWindow} ` +
        `minus requested output ${input.budget.requestedOutputTokens} and safety margin ` +
        `${input.budget.safetyMarginTokens} leaves no input-token budget.`,
    );
  }

  const omittedSections: string[] = [];
  const compactedSections = new Set<string>();
  // Highest numeric priority is the first compaction target.  The stable
  // index tie-break keeps results reproducible even for custom section names.
  const targets = sections
    .map((section, index) => ({ section, index }))
    .sort((left, right) =>
      (right.section.priority ?? 0) - (left.section.priority ?? 0) || left.index - right.index,
    );

  for (const target of targets) {
    if (estimateTokens(prompt) <= maxInputTokens) break;
    const original = sections[target.index]!.text;
    let low = 0;
    let high = original.length;
    let best = "";

    // Find the largest deterministic summary of this section that permits the
    // complete prompt to fit.  The candidate is monotonic in its character
    // budget, so binary search is stable and cheap even for very large prompts.
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = buildWithCandidate(sections, target.index, middle);
      if (estimateTokens(candidate.prompt) <= maxInputTokens) {
        best = candidate.section.text;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    if (best.length === 0) {
      if (target.section.required) continue;
      omittedSections.push(target.section.name);
      sections[target.index]!.text = "";
    } else {
      sections[target.index]!.text = best;
      if (best.length < original.length) compactedSections.add(target.section.name);
    }
    prompt = build();
  }

  const promptTokenEstimate = estimateTokens(prompt);
  if (promptTokenEstimate > maxInputTokens) {
    throw new Error(
      `OpenCode prompt exceeds the model context budget after deterministic compaction: ` +
        `estimated input ${promptTokenEstimate} tokens, budget ${maxInputTokens} ` +
        `(context ${input.budget.contextWindow}, output ${input.budget.requestedOutputTokens}, ` +
        `safety margin ${input.budget.safetyMarginTokens}). ` +
        `Shorten the configured instructions/context or lower the requested output budget.`,
    );
  }

  return {
    prompt,
    sections: sections.filter((section) => section.text.trim().length > 0).map((section) => ({ ...section })),
    metrics: {
      promptTokenEstimate,
      promptTokenBudget: maxInputTokens,
      promptContextWindow: input.budget.contextWindow,
      promptOutputTokens: input.budget.requestedOutputTokens,
      promptSafetyMarginTokens: input.budget.safetyMarginTokens,
      promptTrimmed: 1,
      promptTrimmedSections: compactedSections.size,
      promptOmittedSections: omittedSections.length,
    },
    trimmed: true,
    omittedSections,
  };
}
