import { AssociatedProviderResourceKinds } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { observeSlackRoutableResourceFromEgressResponse } from "./provider-resource-associations.js";

describe("observeSlackRoutableResourceFromEgressResponse", () => {
  it("observes top-level chat.postMessage responses as Slack thread resources", () => {
    expect(
      observeSlackRoutableResourceFromEgressResponse({
        method: "POST",
        path: "/api/chat.postMessage",
        requestBody: encodeJson({ channel: "C123", text: "Please review this." }),
        responseBody: {
          ok: true,
          channel: "C123",
          ts: "1710000000.000100",
        },
        status: 200,
      }),
    ).toEqual({
      extractionMethod: "slack_chat_post_message_response_fields",
      resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
      providerResourceId: "C123:1710000000.000100",
    });
  });

  it("does not observe replies into existing Slack threads", () => {
    expect(
      observeSlackRoutableResourceFromEgressResponse({
        method: "POST",
        path: "/api/chat.postMessage",
        requestBody: encodeJson({
          channel: "C123",
          text: "Replying here.",
          thread_ts: "1710000000.000100",
        }),
        responseBody: {
          ok: true,
          channel: "C123",
          ts: "1710000001.000200",
        },
        status: 200,
      }),
    ).toBeNull();
  });
});

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}
