import type { AgentConversationGenerateTitleResult } from "@mistle/integrations-core";
import { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { createNodeSandboxSessionRuntime } from "@mistle/sandbox-session-client/node";

import { createPiSessionClient } from "./client.js";

const MaxPiGeneratedTitleLength = 64;

export async function generatePiConversationTitle(input: {
  connectionUrl: string;
  providerConversationId: string;
  inputText: string;
}): Promise<AgentConversationGenerateTitleResult> {
  const runtime = createNodeSandboxSessionRuntime();
  const transport = new SandboxSessionTransport({
    runtime,
  });

  await transport.connect({
    connectionUrl: input.connectionUrl,
  });

  const client = createPiSessionClient({
    transport,
  });
  try {
    await client.connect();
    const resolvedConversation = await client.resolveConversation({
      providerConversationId: input.providerConversationId,
    });
    const metadata = await client.readMetadata({
      sessionFile: resolvedConversation.sessionFile,
    });
    if (metadata.name !== null && metadata.name.trim().length > 0) {
      return { title: metadata.name };
    }

    const title = derivePiConversationTitle(input.inputText);
    await client.setSessionName({
      sessionFile: resolvedConversation.sessionFile,
      name: title,
    });

    return { title };
  } finally {
    client.close();
    transport.disconnect(1000, "Pi title generation completed");
  }
}

function derivePiConversationTitle(inputText: string): string {
  const normalized = inputText
    .replaceAll("`", "")
    .split(/\s+/u)
    .filter((part) => part.length > 0)
    .join(" ");
  if (normalized.length === 0) {
    throw new Error("Cannot generate Pi conversation title from empty input.");
  }

  if (normalized.length <= MaxPiGeneratedTitleLength) {
    return normalized;
  }

  const truncated = normalized.slice(0, MaxPiGeneratedTitleLength + 1);
  const lastSpaceIndex = truncated.lastIndexOf(" ");
  if (lastSpaceIndex <= 0) {
    return normalized.slice(0, MaxPiGeneratedTitleLength);
  }

  return truncated.slice(0, lastSpaceIndex);
}
