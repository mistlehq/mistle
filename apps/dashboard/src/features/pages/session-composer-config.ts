export type ComposerConfigSnapshot = {
  model: string | null;
  modelReasoningEffort: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readComposerConfigSnapshot(configJson: string | null): ComposerConfigSnapshot {
  if (configJson === null) {
    return {
      model: null,
      modelReasoningEffort: null,
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(configJson);
  } catch {
    return {
      model: null,
      modelReasoningEffort: null,
    };
  }

  if (!isRecord(parsedJson)) {
    return {
      model: null,
      modelReasoningEffort: null,
    };
  }

  const model = parsedJson["model"];
  const modelReasoningEffort = parsedJson["model_reasoning_effort"];

  return {
    model: typeof model === "string" ? model : null,
    modelReasoningEffort: typeof modelReasoningEffort === "string" ? modelReasoningEffort : null,
  };
}
