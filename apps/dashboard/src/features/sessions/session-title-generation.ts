import { buildPiTitleGenerationShellScript } from "@mistle/integrations-definitions/agent-runtimes/pi/title-generation-command";
import { ExecStreamClient, type SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { z } from "zod";

import {
  patchSandboxInstanceTitle,
  type PatchSandboxInstanceTitleResult,
} from "./sessions-service.js";

const SessionTitleGenerationCommandTimeoutMs = 180_000;
const SessionTitleGenerationResultWaitTimeoutMs = SessionTitleGenerationCommandTimeoutMs + 10_000;
const SessionTitleGenerationMaxOutputBytes = 4096;
const SessionTitleMaxLength = 50;

const SessionTitleGenerationOutputSchema = z
  .object({
    title: z.string().min(1),
  })
  .strict();

export function buildSessionTitleGenerationPrompt(messagePayload: string): string {
  return [
    "You write concise titles for agent sessions.",
    "",
    'Return only a JSON object with this exact shape: {"title":"..."}',
    "",
    "Rules:",
    "- Interpret the message or payload that started the session.",
    "- Summarize the concrete task, trigger, issue, workflow, or intent.",
    "- Do not restate the message or payload verbatim.",
    "- Use 3-8 words.",
    "- No quotes, prefixes, trailing punctuation, or markdown.",
    `- Max ${String(SessionTitleMaxLength)} characters.`,
    "",
    "Message or payload:",
    messagePayload,
  ].join("\n");
}

export function normalizeGeneratedSessionTitle(title: string): string {
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  if (normalizedTitle.length === 0) {
    throw new Error("Generated session title is empty.");
  }

  const cappedTitle =
    normalizedTitle.length <= SessionTitleMaxLength
      ? normalizedTitle
      : normalizedTitle.slice(0, SessionTitleMaxLength).trimEnd();
  const titleWithoutTrailingPunctuation = cappedTitle.replace(/[.,;:!?]+$/u, "").trim();
  if (titleWithoutTrailingPunctuation.length === 0) {
    throw new Error("Generated session title is empty after normalization.");
  }

  return titleWithoutTrailingPunctuation;
}

export function parseSessionTitleGenerationOutput(output: string): string {
  const trimmedOutput = output.trim();
  if (trimmedOutput.length === 0) {
    throw new Error("Codex title generation returned empty output.");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(trimmedOutput);
  } catch (error) {
    throw new Error("Codex title generation returned output that is not valid JSON.", {
      cause: error,
    });
  }
  const parsedOutput = SessionTitleGenerationOutputSchema.safeParse(parsedJson);
  if (!parsedOutput.success) {
    throw new Error("Codex title generation returned an invalid JSON payload.");
  }

  return normalizeGeneratedSessionTitle(parsedOutput.data.title);
}

export function buildSandboxPiTitleGenerationShellScript(): string {
  return buildPiTitleGenerationShellScript();
}

export async function generateSessionTitleWithSandboxCodexExec(input: {
  cwd: string | null;
  ensureTransportConnected: (input: { sandboxInstanceId: string }) => Promise<{
    sandboxInstanceId: string;
    transport: SandboxSessionTransport;
  }>;
  messagePayload: string;
  sandboxInstanceId: string;
}): Promise<PatchSandboxInstanceTitleResult> {
  return generateSessionTitleWithSandboxExec({
    ...input,
    failureLabel: "Codex title generation",
    shellScript: [
      "schema=$(mktemp)",
      "output=$(mktemp)",
      'trap \'rm -f "$schema" "$output"\' EXIT',
      'printf \'%s\\n\' \'{"type":"object","properties":{"title":{"type":"string","minLength":1}},"required":["title"],"additionalProperties":false}\' > "$schema"',
      'codex exec --ephemeral --skip-git-repo-check --sandbox read-only --model gpt-5.4-mini -c model_reasoning_effort=\\"low\\" --output-schema "$schema" -o "$output" - >/dev/null',
      'cat "$output"',
    ].join("; "),
  });
}

export async function generateSessionTitleWithSandboxPiExec(input: {
  cwd: string | null;
  ensureTransportConnected: (input: { sandboxInstanceId: string }) => Promise<{
    sandboxInstanceId: string;
    transport: SandboxSessionTransport;
  }>;
  messagePayload: string;
  sandboxInstanceId: string;
}): Promise<PatchSandboxInstanceTitleResult> {
  return generateSessionTitleWithSandboxExec({
    ...input,
    failureLabel: "Pi title generation",
    shellScript: buildSandboxPiTitleGenerationShellScript(),
  });
}

async function generateSessionTitleWithSandboxExec(input: {
  cwd: string | null;
  ensureTransportConnected: (input: { sandboxInstanceId: string }) => Promise<{
    sandboxInstanceId: string;
    transport: SandboxSessionTransport;
  }>;
  failureLabel: string;
  messagePayload: string;
  sandboxInstanceId: string;
  shellScript: string;
}): Promise<PatchSandboxInstanceTitleResult> {
  const { transport } = await input.ensureTransportConnected({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const exec = new ExecStreamClient({
    idleTimeoutMs: SessionTitleGenerationResultWaitTimeoutMs,
    transport,
  });
  const prompt = buildSessionTitleGenerationPrompt(input.messagePayload);
  const result = await exec.run({
    args: ["-euc", input.shellScript],
    command: "sh",
    ...(input.cwd === null ? {} : { cwd: input.cwd }),
    maxOutputBytes: SessionTitleGenerationMaxOutputBytes,
    stdin: prompt,
    timeoutMs: SessionTitleGenerationCommandTimeoutMs,
  });

  if (result.exitCode !== 0) {
    const detail = [result.stderr.trim(), result.stdout.trim()].find((value) => value.length > 0);
    const message =
      detail === undefined
        ? `${input.failureLabel} failed.`
        : `${input.failureLabel} failed: ${detail}`;
    throw new Error(message);
  }

  const title = parseSessionTitleGenerationOutput(result.stdout);
  return patchSandboxInstanceTitle({
    instanceId: input.sandboxInstanceId,
    onlyIfUnset: true,
    title,
  });
}
