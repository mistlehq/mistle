import { AssociatedProviderResourceKinds } from "@mistle/integrations-core";
import { z } from "zod";

const SlackPostMessageRequestSchema = z.looseObject({
  channel: z.string().min(1),
  thread_ts: z.string().min(1).optional(),
});

const SlackPostMessageResponseSchema = z.looseObject({
  ok: z.literal(true),
  channel: z.string().min(1),
  ts: z.string().min(1),
});

export type SlackThreadProviderResourceExtractionMethod = "slack_chat_post_message_response_fields";

export type SlackRoutableResourceObservation = {
  extractionMethod: SlackThreadProviderResourceExtractionMethod;
  resourceKind: "slack.thread";
  providerResourceId: string;
};

export function observeSlackRoutableResourceFromEgressResponse(input: {
  method: string;
  path: string;
  requestBody?: Uint8Array | undefined;
  responseBody: unknown;
  status: number;
}): SlackRoutableResourceObservation | null {
  if (!isSuccessfulResponse(input.status) || !isSlackTopLevelPostMessageRequest(input)) {
    return null;
  }

  const parsedResponse = SlackPostMessageResponseSchema.safeParse(input.responseBody);
  if (!parsedResponse.success) {
    return null;
  }

  return {
    extractionMethod: "slack_chat_post_message_response_fields",
    resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
    providerResourceId: createSlackThreadProviderResourceId({
      channel: parsedResponse.data.channel,
      threadRootTs: parsedResponse.data.ts,
    }),
  };
}

export function createSlackThreadProviderResourceId(input: {
  channel: string;
  threadRootTs: string;
}): string {
  return `${input.channel}:${input.threadRootTs}`;
}

export function isSlackTopLevelPostMessageRequest(input: {
  method: string;
  path: string;
  requestBody?: Uint8Array | undefined;
}): boolean {
  if (input.method.toUpperCase() !== "POST" || !input.path.endsWith("/chat.postMessage")) {
    return false;
  }

  const parsedRequest = SlackPostMessageRequestSchema.safeParse(
    parseJsonRequestBody(input.requestBody),
  );
  return parsedRequest.success && parsedRequest.data.thread_ts === undefined;
}

function isSuccessfulResponse(status: number): boolean {
  return status >= 200 && status < 300;
}

function parseJsonRequestBody(body: Uint8Array | undefined): unknown {
  if (body === undefined || body.byteLength === 0) {
    return null;
  }

  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
}
