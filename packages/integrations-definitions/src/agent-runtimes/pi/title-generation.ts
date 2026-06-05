import type { AgentConversationGenerateTitleResult } from "@mistle/integrations-core";
import { ExecStreamClient, SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { createNodeSandboxSessionRuntime } from "@mistle/sandbox-session-client/node";
import { z } from "zod";

import { buildPiTitleGenerationShellScript } from "./title-generation-command.js";

const PiConversationTitleGenerationCommandTimeoutMs = 180_000;
const PiConversationTitleGenerationResultWaitTimeoutMs =
  PiConversationTitleGenerationCommandTimeoutMs + 10_000;
const PiConversationTitleGenerationMaxOutputBytes = 4096;
const ConversationTitleMaxLength = 50;

const ConversationTitleGenerationOutputSchema = z
  .object({
    title: z.string().min(1),
  })
  .strict();

export function buildPiConversationTitleGenerationPrompt(inputText: string): string {
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
    `- Max ${String(ConversationTitleMaxLength)} characters.`,
    "",
    "Pull request rule:",
    "- If the input is about a pull request and includes a concrete pull request number, title it as PR #<number> <pull request title/topic>.",
    "- If the pull request number is missing, title it from the pull request title/topic without inventing a number or using a placeholder.",
    "",
    "Message:",
    inputText,
  ].join("\n");
}

export function buildPiConversationTitleGenerationShellScript(): string {
  return buildPiTitleGenerationShellScript();
}

export function normalizeGeneratedPiConversationTitle(title: string): string {
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  if (normalizedTitle.length === 0) {
    throw new Error("Generated Pi conversation title is empty.");
  }

  const cappedTitle =
    normalizedTitle.length <= ConversationTitleMaxLength
      ? normalizedTitle
      : normalizedTitle.slice(0, ConversationTitleMaxLength).trimEnd();
  const titleWithoutTrailingPunctuation = cappedTitle.replace(/[.,;:!?]+$/u, "").trim();
  if (titleWithoutTrailingPunctuation.length === 0) {
    throw new Error("Generated Pi conversation title is empty after normalization.");
  }

  return titleWithoutTrailingPunctuation;
}

export function parsePiConversationTitleGenerationOutput(output: string): string {
  const trimmedOutput = output.trim();
  if (trimmedOutput.length === 0) {
    throw new Error("Pi conversation title generation returned empty output.");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(trimmedOutput);
  } catch (error) {
    throw new Error("Pi conversation title generation returned output that is not valid JSON.", {
      cause: error,
    });
  }
  const parsedOutput = ConversationTitleGenerationOutputSchema.safeParse(parsedJson);
  if (!parsedOutput.success) {
    throw new Error("Pi conversation title generation returned an invalid JSON payload.");
  }

  return normalizeGeneratedPiConversationTitle(parsedOutput.data.title);
}

export async function generatePiConversationTitle(input: {
  connectionUrl: string;
  providerConversationId: string;
  inputText: string;
}): Promise<AgentConversationGenerateTitleResult> {
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
      idleTimeoutMs: PiConversationTitleGenerationResultWaitTimeoutMs,
      transport,
    });
    const result = await exec.run({
      args: ["-euc", buildPiConversationTitleGenerationShellScript()],
      command: "sh",
      maxOutputBytes: PiConversationTitleGenerationMaxOutputBytes,
      stdin: buildPiConversationTitleGenerationPrompt(input.inputText),
      timeoutMs: PiConversationTitleGenerationCommandTimeoutMs,
    });

    if (result.exitCode !== 0) {
      const detail = [result.stderr.trim(), result.stdout.trim()].find((value) => value.length > 0);
      throw new Error(
        detail === undefined
          ? "Pi conversation title generation failed."
          : `Pi conversation title generation failed: ${detail}`,
      );
    }

    return {
      title: parsePiConversationTitleGenerationOutput(result.stdout),
    };
  } finally {
    transport.disconnect(1000, "Pi conversation title generated");
  }
}
