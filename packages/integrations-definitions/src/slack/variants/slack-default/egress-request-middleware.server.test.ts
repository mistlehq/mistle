import { describe, expect, it } from "vitest";

import { AppendSessionLinkToSlackTextRequestMiddleware } from "./egress-request-middleware.server.js";

const SessionUrl = "https://control-plane.example.test/p/sessions/sandbox_123";

function createSlackRequest(input: { method?: string; pathname?: string; body?: string }) {
  return {
    method: input.method ?? "POST",
    url: new URL(`https://slack.com${input.pathname ?? "/api/chat.postMessage"}`),
    headers: new Headers({
      "content-type": "application/json",
    }),
    body: input.body === undefined ? undefined : new TextEncoder().encode(input.body),
  };
}

describe("AppendSessionLinkToSlackTextRequestMiddleware", () => {
  it("appends a divider and clickable session link to chat.postMessage text", async () => {
    const request = createSlackRequest({
      body: JSON.stringify({
        channel: "C123",
        text: "Hello from Mistle",
      }),
    });

    const result = await AppendSessionLinkToSlackTextRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request,
    });

    const decodedBody = new TextDecoder().decode(result.body);
    expect(JSON.parse(decodedBody)).toEqual({
      channel: "C123",
      text: `Hello from Mistle\n\n──────────\n<${SessionUrl}|🔗 View session>`,
    });
  });

  it("does not append the session link twice when it is already present", async () => {
    const request = createSlackRequest({
      body: JSON.stringify({
        channel: "C123",
        text: `Hello from Mistle\n\n──────────\n<${SessionUrl}|🔗 View session>`,
      }),
    });

    const result = await AppendSessionLinkToSlackTextRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request,
    });

    const decodedBody = new TextDecoder().decode(result.body);
    expect(JSON.parse(decodedBody)).toEqual({
      channel: "C123",
      text: `Hello from Mistle\n\n──────────\n<${SessionUrl}|🔗 View session>`,
    });
  });

  it("appends the session link to chat.update text", async () => {
    const request = createSlackRequest({
      pathname: "/api/chat.update",
      body: JSON.stringify({
        channel: "C123",
        ts: "123.456",
        text: "Updated from Mistle",
      }),
    });

    const result = await AppendSessionLinkToSlackTextRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request,
    });

    const decodedBody = new TextDecoder().decode(result.body);
    expect(JSON.parse(decodedBody)).toEqual({
      channel: "C123",
      ts: "123.456",
      text: `Updated from Mistle\n\n──────────\n<${SessionUrl}|🔗 View session>`,
    });
  });

  it("no-ops for non-target Slack endpoints and non-string text fields", async () => {
    const nonTargetRequest = createSlackRequest({
      pathname: "/api/conversations.create",
      body: JSON.stringify({
        name: "mistle-thread",
        text: "should not change",
      }),
    });
    const missingTextRequest = createSlackRequest({
      pathname: "/api/chat.update",
      body: JSON.stringify({
        channel: "C123",
        blocks: [],
      }),
    });

    const nonTargetResult = await AppendSessionLinkToSlackTextRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request: nonTargetRequest,
    });
    const missingTextResult = await AppendSessionLinkToSlackTextRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request: missingTextRequest,
    });

    expect(new TextDecoder().decode(nonTargetResult.body)).toBe(
      JSON.stringify({
        name: "mistle-thread",
        text: "should not change",
      }),
    );
    expect(new TextDecoder().decode(missingTextResult.body)).toBe(
      JSON.stringify({
        channel: "C123",
        blocks: [],
      }),
    );
  });
});
