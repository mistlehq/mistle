import type {
  DataPlaneDatabase,
  SandboxLifecyclePhase,
  SandboxOperationTranscriptStream,
} from "@mistle/db/data-plane";

const BootstrapDisconnectedDuringStartupFailureCode = "bootstrap_disconnected_during_startup";
const MaxFailedLifecycleEvents = 50;
const MaxTranscriptEvents = 20;
const MaxDetailCharacters = 2_000;

export type StartupFailureEvidenceEvent = {
  operationId: string;
  sequence: number;
  recordKind: string;
  observedAt: string;
  createdAt: string;
  phase: SandboxLifecyclePhase | null;
  status: string | null;
  stream: SandboxOperationTranscriptStream | null;
  message: string;
  payloadBytes: Buffer | null;
  attributes: Record<string, unknown>;
};

export type StartupFailureEvidence = {
  phase: SandboxLifecyclePhase;
  message: string;
  detail: string | null;
  operationId: string;
  sequence: number;
};

export async function resolveStartupFailureEvidence(ctx: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<StartupFailureEvidence | null> {
  const lifecycleEvents = await ctx.db.query.sandboxOperationEvents.findMany({
    columns: {
      operationId: true,
      sequence: true,
      recordKind: true,
      observedAt: true,
      createdAt: true,
      phase: true,
      status: true,
      stream: true,
      message: true,
      payloadBytes: true,
      attributes: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxInstanceId, ctx.sandboxInstanceId),
        eq(table.recordKind, "lifecycle"),
        eq(table.status, "failed"),
      ),
    orderBy: (table, { desc }) => [desc(table.createdAt), desc(table.sequence)],
    limit: MaxFailedLifecycleEvents,
  });

  const selectedEvent = selectStartupFailureEvidenceEvent(lifecycleEvents);
  if (selectedEvent === null || selectedEvent.phase === null) {
    return null;
  }

  const transcriptDetail = hasFailureDetailAttribute(selectedEvent)
    ? null
    : await resolveTranscriptDetail(ctx, selectedEvent);

  return createStartupFailureEvidence({
    event: selectedEvent,
    transcriptDetail,
  });
}

export function shouldEnrichStartupDisconnectFailure(input: { failureCode: string }): boolean {
  return input.failureCode === BootstrapDisconnectedDuringStartupFailureCode;
}

export function formatStartupDisconnectFailureMessage(input: {
  baseFailureMessage: string;
  evidence: StartupFailureEvidence | null;
}): string {
  if (input.evidence === null) {
    return input.baseFailureMessage;
  }

  const lines = [
    `${input.baseFailureMessage} Last observed startup failure: ${formatPhaseLabel(
      input.evidence.phase,
    )}.`,
  ];

  const summary = sanitizeDetail(input.evidence.message);
  if (summary !== null) {
    lines.push("", `Failure: ${summary}`);
  }

  if (input.evidence.detail !== null && input.evidence.detail !== summary) {
    lines.push("", `Cause: ${input.evidence.detail}`);
  }

  return lines.join("\n");
}

export function selectStartupFailureEvidenceEvent(
  events: StartupFailureEvidenceEvent[],
): StartupFailureEvidenceEvent | null {
  const candidates = events.filter(isStartupFailureLifecycleEvent);
  if (candidates.length === 0) {
    return null;
  }

  const sortedCandidates = [...candidates];
  sortedCandidates.sort(compareStartupFailureEvidenceEvents);
  return sortedCandidates[0] ?? null;
}

async function resolveTranscriptDetail(
  ctx: {
    db: DataPlaneDatabase;
    sandboxInstanceId: string;
  },
  event: StartupFailureEvidenceEvent,
): Promise<string | null> {
  if (event.phase === null) {
    return null;
  }

  const transcriptEvents = await ctx.db.query.sandboxOperationEvents.findMany({
    columns: {
      operationId: true,
      sequence: true,
      recordKind: true,
      observedAt: true,
      createdAt: true,
      phase: true,
      status: true,
      stream: true,
      message: true,
      payloadBytes: true,
      attributes: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxInstanceId, ctx.sandboxInstanceId),
        eq(table.operationId, event.operationId),
      ),
    orderBy: (table, { desc }) => [desc(table.sequence)],
    limit: MaxTranscriptEvents,
  });

  return formatTranscriptTail(
    transcriptEvents.filter(
      (transcriptEvent) =>
        transcriptEvent.recordKind === "transcript" &&
        transcriptEvent.phase === event.phase &&
        transcriptEvent.payloadBytes !== null,
    ),
  );
}

function createStartupFailureEvidence(input: {
  event: StartupFailureEvidenceEvent;
  transcriptDetail: string | null;
}): StartupFailureEvidence {
  return {
    phase: requireLifecyclePhase(input.event),
    message: resolveFailureMessage(input.event),
    detail: resolveFailureDetail(input.event, input.transcriptDetail),
    operationId: input.event.operationId,
    sequence: input.event.sequence,
  };
}

function requireLifecyclePhase(event: StartupFailureEvidenceEvent): SandboxLifecyclePhase {
  if (event.phase === null) {
    throw new Error("Expected startup failure evidence event to have a lifecycle phase.");
  }

  return event.phase;
}

function resolveFailureMessage(event: StartupFailureEvidenceEvent): string {
  const error = readStringAttribute(event.attributes, "error");
  if (error !== null) {
    return error;
  }

  return event.message;
}

function resolveFailureDetail(
  event: StartupFailureEvidenceEvent,
  transcriptDetail: string | null,
): string | null {
  const stderrTail = readStringAttribute(event.attributes, "stderrTail");
  if (stderrTail !== null) {
    return sanitizeDetail(stderrTail);
  }

  const stdoutTail = readStringAttribute(event.attributes, "stdoutTail");
  if (stdoutTail !== null) {
    return sanitizeDetail(stdoutTail);
  }

  return transcriptDetail;
}

function hasFailureDetailAttribute(event: StartupFailureEvidenceEvent): boolean {
  return (
    readStringAttribute(event.attributes, "stderrTail") !== null ||
    readStringAttribute(event.attributes, "stdoutTail") !== null
  );
}

function isStartupFailureLifecycleEvent(event: StartupFailureEvidenceEvent): boolean {
  return event.recordKind === "lifecycle" && event.status === "failed" && event.phase !== null;
}

function compareStartupFailureEvidenceEvents(
  left: StartupFailureEvidenceEvent,
  right: StartupFailureEvidenceEvent,
): number {
  const phasePriorityDifference = phasePriority(left.phase) - phasePriority(right.phase);
  if (phasePriorityDifference !== 0) {
    return phasePriorityDifference;
  }

  const observedAtComparison = compareStringsDescending(left.observedAt, right.observedAt);
  if (observedAtComparison !== 0) {
    return observedAtComparison;
  }

  const createdAtComparison = compareStringsDescending(left.createdAt, right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  return right.sequence - left.sequence;
}

function phasePriority(phase: SandboxLifecyclePhase | null): number {
  switch (phase) {
    case "setup_script":
      return 0;
    case "runtime_plan":
      return 1;
    case "runtime_processes":
      return 2;
    case "runtime_adapters":
      return 3;
    case "agent_endpoint":
      return 4;
    case "egress":
      return 5;
    case "operation_stream":
      return 6;
    case "sandboxd":
      return 7;
    default:
      return 100;
  }
}

function compareStringsDescending(left: string, right: string): number {
  return right.localeCompare(left);
}

function readStringAttribute(attributes: Record<string, unknown>, key: string): string | null {
  const value = attributes[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value;
}

function formatTranscriptTail(events: StartupFailureEvidenceEvent[]): string | null {
  const lines = events
    .filter((event) => event.payloadBytes !== null)
    .reverse()
    .map((event) => formatTranscriptLine(event))
    .filter((line) => line !== null);

  if (lines.length === 0) {
    return null;
  }

  return sanitizeDetail(lines.join("\n"));
}

function formatTranscriptLine(event: StartupFailureEvidenceEvent): string | null {
  if (event.payloadBytes === null) {
    return null;
  }

  const payload = sanitizeDetail(event.payloadBytes.toString("utf8"));
  if (payload === null) {
    return null;
  }

  if (event.stream === null) {
    return payload;
  }

  return `[${event.stream}] ${payload}`;
}

function sanitizeDetail(detail: string): string | null {
  const sanitized = detail.trim();
  if (sanitized.length === 0) {
    return null;
  }

  if (sanitized.length <= MaxDetailCharacters) {
    return sanitized;
  }

  return sanitized.slice(0, MaxDetailCharacters).trimEnd();
}

function formatPhaseLabel(phase: SandboxLifecyclePhase): string {
  return phase.replaceAll("_", " ");
}
