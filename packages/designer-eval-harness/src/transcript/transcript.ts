import type { CodexThreadReadTurn } from "@mistle/integrations-definitions/agent-runtimes/codex/server";

export function renderTranscriptMarkdown(input: {
  caseId: string;
  threadId: string;
  turns: readonly CodexThreadReadTurn[];
}): string {
  const lines = [
    `# Designer eval transcript: ${input.caseId}`,
    "",
    `Thread: ${input.threadId}`,
    "",
  ];

  for (const turn of input.turns) {
    lines.push(`## Turn ${turn.id}`);
    lines.push("");
    lines.push(`Status: ${turn.status ?? "unknown"}`);
    lines.push("");

    for (const item of turn.items) {
      const text = readItemText(item);
      if (text === null) {
        continue;
      }
      lines.push(text);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function readItemText(item: unknown): string | null {
  if (typeof item !== "object" || item === null) {
    return null;
  }

  for (const key of ["text", "message", "content"]) {
    const value = Reflect.get(item, key);
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}
