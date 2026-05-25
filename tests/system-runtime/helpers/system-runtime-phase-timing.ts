type PhaseTimingAttributeValue = string | number | boolean | null;

export async function timeSystemRuntimePhase<Result>(input: {
  event: string;
  phase: string;
  operation: () => Promise<Result>;
  attributes?: Record<string, PhaseTimingAttributeValue>;
}): Promise<Result> {
  const startedAt = Date.now();

  try {
    return await input.operation();
  } finally {
    const basePayload = {
      event: input.event,
      phase: input.phase,
      durationMs: Date.now() - startedAt,
    };
    const payload =
      input.attributes === undefined ? basePayload : { ...input.attributes, ...basePayload };

    console.log(JSON.stringify(payload));
  }
}
