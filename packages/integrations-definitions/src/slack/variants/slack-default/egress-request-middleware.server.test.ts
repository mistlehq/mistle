import { describe, expect, it } from "vitest";

import { AppendSessionLinkToSlackTextRequestMiddleware } from "./egress-request-middleware.server.js";

const SessionUrl = "https://control-plane.example.test/p/sessions/sandbox_123";
const SessionLinkButtonElement = {
  type: "button",
  action_id: "mistle_view_session",
  text: {
    type: "plain_text",
    text: "View session",
  },
  url: SessionUrl,
};
const SessionLinkButtonBlock = {
  type: "actions",
  block_id: "mistle_session_link",
  elements: [SessionLinkButtonElement],
};

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
  it("adds a session link button to chat.postMessage text", async () => {
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
      text: "Hello from Mistle",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Hello from Mistle",
          },
        },
        SessionLinkButtonBlock,
      ],
    });
  });

  it("does not append the session link button twice when it is already present", async () => {
    const request = createSlackRequest({
      body: JSON.stringify({
        channel: "C123",
        text: "Hello from Mistle",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Hello from Mistle",
            },
          },
          SessionLinkButtonBlock,
        ],
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
      text: "Hello from Mistle",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Hello from Mistle",
          },
        },
        SessionLinkButtonBlock,
      ],
    });
  });

  it("adds the session link button to chat.update text", async () => {
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
      text: "Updated from Mistle",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Updated from Mistle",
          },
        },
        SessionLinkButtonBlock,
      ],
    });
  });

  it("adds the session link button to existing blocks", async () => {
    const request = createSlackRequest({
      body: JSON.stringify({
        channel: "C123",
        text: "Fallback text",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Block text",
            },
          },
        ],
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
      text: "Fallback text",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Block text",
          },
        },
        SessionLinkButtonBlock,
      ],
    });
  });

  it("adds the session link button to an existing actions block with room", async () => {
    const request = createSlackRequest({
      body: JSON.stringify({
        channel: "C123",
        text: "Fallback text",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Block text",
            },
          },
          {
            type: "actions",
            block_id: "existing_actions",
            elements: [
              {
                type: "button",
                action_id: "existing_action",
                text: {
                  type: "plain_text",
                  text: "Existing action",
                },
                value: "existing",
              },
            ],
          },
        ],
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
      text: "Fallback text",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Block text",
          },
        },
        {
          type: "actions",
          block_id: "existing_actions",
          elements: [
            {
              type: "button",
              action_id: "existing_action",
              text: {
                type: "plain_text",
                text: "Existing action",
              },
              value: "existing",
            },
            SessionLinkButtonElement,
          ],
        },
      ],
    });
  });

  it("does not exceed Slack's message block limit", async () => {
    const blocks = Array.from({ length: 50 }, (_value, index) => ({
      type: "section",
      block_id: `section_${index.toString()}`,
      text: {
        type: "mrkdwn",
        text: `Block ${index.toString()}`,
      },
    }));
    const request = createSlackRequest({
      body: JSON.stringify({
        channel: "C123",
        text: "Fallback text",
        blocks,
      }),
    });

    const result = await AppendSessionLinkToSlackTextRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request,
    });

    expect(new TextDecoder().decode(result.body)).toBe(
      JSON.stringify({
        channel: "C123",
        text: "Fallback text",
        blocks,
      }),
    );
  });

  it("does not convert text that exceeds Slack's section text limit", async () => {
    const longText = "x".repeat(3_001);
    const request = createSlackRequest({
      body: JSON.stringify({
        channel: "C123",
        text: longText,
      }),
    });

    const result = await AppendSessionLinkToSlackTextRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request,
    });

    expect(new TextDecoder().decode(result.body)).toBe(
      JSON.stringify({
        channel: "C123",
        text: longText,
      }),
    );
  });

  it("no-ops for non-target Slack endpoints and payloads without text or blocks", async () => {
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
        channel: "C456",
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
        channel: "C456",
      }),
    );
  });
});
