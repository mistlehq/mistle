import { ExecStreamClient, SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { createNodeSandboxSessionRuntime } from "@mistle/sandbox-session-client/node";
import { z } from "zod";

const CodexConversationTitleGenerationCommandTimeoutMs = 180_000;
const CodexConversationTitleGenerationResultWaitTimeoutMs =
  CodexConversationTitleGenerationCommandTimeoutMs + 10_000;
const CodexConversationTitleGenerationMaxOutputBytes = 4096;
const ConversationTitleMaxLength = 50;

const ConversationTitleGenerationOutputSchema = z
  .object({
    title: z.string().min(1),
  })
  .strict();

export function buildCodexConversationTitleGenerationPrompt(inputText: string): string {
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
    "Message:",
    inputText,
  ].join("\n");
}

export function normalizeGeneratedCodexConversationTitle(title: string): string {
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  if (normalizedTitle.length === 0) {
    throw new Error("Generated conversation title is empty.");
  }

  const cappedTitle =
    normalizedTitle.length <= ConversationTitleMaxLength
      ? normalizedTitle
      : normalizedTitle.slice(0, ConversationTitleMaxLength).trimEnd();
  const titleWithoutTrailingPunctuation = cappedTitle.replace(/[.,;:!?]+$/u, "").trim();
  if (titleWithoutTrailingPunctuation.length === 0) {
    throw new Error("Generated conversation title is empty after normalization.");
  }

  return titleWithoutTrailingPunctuation;
}

export function parseCodexConversationTitleGenerationOutput(output: string): string {
  const trimmedOutput = output.trim();
  if (trimmedOutput.length === 0) {
    throw new Error("Codex conversation title generation returned empty output.");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(trimmedOutput);
  } catch (error) {
    throw new Error("Codex conversation title generation returned output that is not valid JSON.", {
      cause: error,
    });
  }
  const parsedOutput = ConversationTitleGenerationOutputSchema.safeParse(parsedJson);
  if (!parsedOutput.success) {
    throw new Error("Codex conversation title generation returned an invalid JSON payload.");
  }

  return normalizeGeneratedCodexConversationTitle(parsedOutput.data.title);
}

export async function generateConversationTitleWithSandboxCodexExec(input: {
  connectionUrl: string;
  inputText: string;
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
      idleTimeoutMs: CodexConversationTitleGenerationResultWaitTimeoutMs,
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
      maxOutputBytes: CodexConversationTitleGenerationMaxOutputBytes,
      stdin: buildCodexConversationTitleGenerationPrompt(input.inputText),
      timeoutMs: CodexConversationTitleGenerationCommandTimeoutMs,
    });

    if (result.exitCode !== 0) {
      const detail = [result.stderr.trim(), result.stdout.trim()].find((value) => value.length > 0);
      throw new Error(
        detail === undefined
          ? "Codex conversation title generation failed."
          : `Codex conversation title generation failed: ${detail}`,
      );
    }

    return parseCodexConversationTitleGenerationOutput(result.stdout);
  } finally {
    transport.disconnect(1000, "conversation title generated");
  }
}
