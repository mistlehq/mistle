import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { ExecStreamClient, SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { createNodeSandboxSessionRuntime } from "@mistle/sandbox-session-client/node";
import { z } from "zod";

const SandboxSessionTitleGenerationCommandTimeoutMs = 180_000;
const SandboxSessionTitleGenerationResultWaitTimeoutMs =
  SandboxSessionTitleGenerationCommandTimeoutMs + 10_000;
const SandboxSessionTitleGenerationMaxOutputBytes = 4096;
const SessionTitleMaxLength = 50;

const SessionTitleGenerationOutputSchema = z
  .object({
    title: z.string().min(1),
  })
  .strict();

export function buildAutomationSessionTitleGenerationPrompt(messagePayload: string): string {
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
    "Message:",
    messagePayload,
  ].join("\n");
}

export function normalizeGeneratedAutomationSessionTitle(title: string): string {
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  if (normalizedTitle.length === 0) {
    throw new Error("Generated automation session title is empty.");
  }

  const cappedTitle =
    normalizedTitle.length <= SessionTitleMaxLength
      ? normalizedTitle
      : normalizedTitle.slice(0, SessionTitleMaxLength).trimEnd();
  const titleWithoutTrailingPunctuation = cappedTitle.replace(/[.,;:!?]+$/u, "").trim();
  if (titleWithoutTrailingPunctuation.length === 0) {
    throw new Error("Generated automation session title is empty after normalization.");
  }

  return titleWithoutTrailingPunctuation;
}

export function parseAutomationSessionTitleGenerationOutput(output: string): string {
  const trimmedOutput = output.trim();
  if (trimmedOutput.length === 0) {
    throw new Error("Codex automation title generation returned empty output.");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(trimmedOutput);
  } catch (error) {
    throw new Error("Codex automation title generation returned output that is not valid JSON.", {
      cause: error,
    });
  }
  const parsedOutput = SessionTitleGenerationOutputSchema.safeParse(parsedJson);
  if (!parsedOutput.success) {
    throw new Error("Codex automation title generation returned an invalid JSON payload.");
  }

  return normalizeGeneratedAutomationSessionTitle(parsedOutput.data.title);
}

export async function generateAutomationSessionTitleWithSandboxCodexExec(input: {
  connectionUrl: string;
  messagePayload: string;
}): Promise<string> {
  const runtime = createNodeSandboxSessionRuntime();
  const transport = new SandboxSessionTransport({
    runtime,
    connectTimeoutMs: 30_000,
  });

  await transport.connect({
    connectionUrl: input.connectionUrl,
  });

  try {
    const exec = new ExecStreamClient({
      idleTimeoutMs: SandboxSessionTitleGenerationResultWaitTimeoutMs,
      transport,
    });
    const result = await exec.run({
      args: [
        "-euc",
        [
          "schema=$(mktemp)",
          "output=$(mktemp)",
          'trap \'rm -f "$schema" "$output"\' EXIT',
          'printf \'%s\\n\' \'{"type":"object","properties":{"title":{"type":"string","minLength":1}},"required":["title"],"additionalProperties":false}\' > "$schema"',
          'codex exec --ephemeral --skip-git-repo-check --sandbox read-only --model gpt-5.4-mini -c model_reasoning_effort=\\"low\\" --output-schema "$schema" -o "$output" - >/dev/null',
          'cat "$output"',
        ].join("; "),
      ],
      command: "sh",
      maxOutputBytes: SandboxSessionTitleGenerationMaxOutputBytes,
      stdin: buildAutomationSessionTitleGenerationPrompt(input.messagePayload),
      timeoutMs: SandboxSessionTitleGenerationCommandTimeoutMs,
    });

    if (result.exitCode !== 0) {
      const detail = [result.stderr.trim(), result.stdout.trim()].find((value) => value.length > 0);
      throw new Error(
        detail === undefined
          ? "Codex automation title generation failed."
          : `Codex automation title generation failed: ${detail}`,
      );
    }

    return parseAutomationSessionTitleGenerationOutput(result.stdout);
  } finally {
    transport.disconnect(1000, "automation title generated");
  }
}

export async function seedSandboxInstanceTitle(
  deps: {
    dataPlaneClient: Pick<
      DataPlaneSandboxInstancesClient,
      "getSandboxInstance" | "patchSandboxInstanceTitle"
    >;
  },
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    connectionUrl: string;
    messagePayload: string;
  },
): Promise<void> {
  const sandboxInstance = await deps.dataPlaneClient.getSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.sandboxInstanceId,
  });
  if (sandboxInstance === null) {
    throw new Error(`Sandbox instance '${input.sandboxInstanceId}' was not found.`);
  }
  if (sandboxInstance.title !== null) {
    return;
  }

  const title = await generateAutomationSessionTitleWithSandboxCodexExec({
    connectionUrl: input.connectionUrl,
    messagePayload: input.messagePayload,
  });

  await deps.dataPlaneClient.patchSandboxInstanceTitle({
    organizationId: input.organizationId,
    instanceId: input.sandboxInstanceId,
    onlyIfUnset: true,
    title,
  });
}
