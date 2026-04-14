import { describe, expect, it } from "vitest";

import { AppendSessionLinkToLinearMcpMarkdownRequestMiddleware } from "./egress-request-middleware.server.js";

const SessionUrl = "https://control-plane.example.test/p/sessions/sandbox_123";

function createLinearMcpRequest(input: { body: unknown; pathname?: string; method?: string }) {
  return {
    method: input.method ?? "POST",
    url: new URL(`https://mcp.linear.app${input.pathname ?? "/mcp"}`),
    headers: new Headers({
      "content-type": "application/json",
    }),
    body: new TextEncoder().encode(JSON.stringify(input.body)),
  };
}

describe("AppendSessionLinkToLinearMcpMarkdownRequestMiddleware", () => {
  it("appends the markdown footer to save_issue create requests", async () => {
    const request = createLinearMcpRequest({
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "save_issue",
          arguments: {
            title: "Webhook regression",
            team: "MIST",
            description: "Issue body",
          },
        },
      },
    });

    const result = await AppendSessionLinkToLinearMcpMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request,
    });

    expect(JSON.parse(new TextDecoder().decode(result.body))).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "save_issue",
        arguments: {
          title: "Webhook regression",
          team: "MIST",
          description: `Issue body\n\n---\n[🔗 View session](${SessionUrl})`,
        },
      },
    });
  });

  it("appends the markdown footer to save_comment create requests", async () => {
    const request = createLinearMcpRequest({
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "save_comment",
          arguments: {
            issueId: "MIST-123",
            body: "Comment body",
          },
        },
      },
    });

    const result = await AppendSessionLinkToLinearMcpMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request,
    });

    expect(JSON.parse(new TextDecoder().decode(result.body))).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "save_comment",
        arguments: {
          issueId: "MIST-123",
          body: `Comment body\n\n---\n[🔗 View session](${SessionUrl})`,
        },
      },
    });
  });

  it("does not append the markdown footer twice", async () => {
    const request = createLinearMcpRequest({
      body: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "save_comment",
          arguments: {
            issueId: "MIST-123",
            body: `Comment body\n\n---\n[🔗 View session](${SessionUrl})`,
          },
        },
      },
    });

    const result = await AppendSessionLinkToLinearMcpMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request,
    });

    expect(JSON.parse(new TextDecoder().decode(result.body))).toEqual({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "save_comment",
        arguments: {
          issueId: "MIST-123",
          body: `Comment body\n\n---\n[🔗 View session](${SessionUrl})`,
        },
      },
    });
  });

  it("does not mutate update calls for save_issue or save_comment", async () => {
    const issueRequest = createLinearMcpRequest({
      body: {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "save_issue",
          arguments: {
            id: "issue-id",
            description: "Updated issue body",
          },
        },
      },
    });
    const commentRequest = createLinearMcpRequest({
      body: {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "save_comment",
          arguments: {
            id: "comment-id",
            body: "Updated comment body",
          },
        },
      },
    });

    const issueResult = await AppendSessionLinkToLinearMcpMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request: issueRequest,
    });
    const commentResult = await AppendSessionLinkToLinearMcpMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request: commentRequest,
    });

    expect(JSON.parse(new TextDecoder().decode(issueResult.body))).toEqual({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "save_issue",
        arguments: {
          id: "issue-id",
          description: "Updated issue body",
        },
      },
    });
    expect(JSON.parse(new TextDecoder().decode(commentResult.body))).toEqual({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "save_comment",
        arguments: {
          id: "comment-id",
          body: "Updated comment body",
        },
      },
    });
  });

  it("does not mutate non-target tool calls or non-mcp requests", async () => {
    const toolListRequest = createLinearMcpRequest({
      body: {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/list",
        params: {},
      },
    });
    const unrelatedToolRequest = createLinearMcpRequest({
      body: {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "get_issue",
          arguments: {
            id: "issue-id",
          },
        },
      },
    });
    const wrongPathRequest = createLinearMcpRequest({
      pathname: "/graphql",
      body: {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "save_comment",
          arguments: {
            body: "Comment body",
          },
        },
      },
    });

    const toolListResult = await AppendSessionLinkToLinearMcpMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request: toolListRequest,
    });
    const unrelatedToolResult = await AppendSessionLinkToLinearMcpMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request: unrelatedToolRequest,
    });
    const wrongPathResult = await AppendSessionLinkToLinearMcpMarkdownRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request: wrongPathRequest,
    });

    expect(JSON.parse(new TextDecoder().decode(toolListResult.body))).toEqual({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/list",
      params: {},
    });
    expect(JSON.parse(new TextDecoder().decode(unrelatedToolResult.body))).toEqual({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "get_issue",
        arguments: {
          id: "issue-id",
        },
      },
    });
    expect(JSON.parse(new TextDecoder().decode(wrongPathResult.body))).toEqual({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "save_comment",
        arguments: {
          body: "Comment body",
        },
      },
    });
  });
});
