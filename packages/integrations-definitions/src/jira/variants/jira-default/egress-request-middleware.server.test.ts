import { describe, expect, it } from "vitest";

import { AppendSessionLinkToJiraDocumentRequestMiddleware } from "./egress-request-middleware.server.js";

const SessionUrl = "https://control-plane.example.test/p/sessions/sandbox_123";

function createJiraRequest(input: { method: string; pathname: string; body: unknown }) {
  return {
    method: input.method,
    url: new URL(`https://mistle.atlassian.net${input.pathname}`),
    headers: new Headers({
      "content-type": "application/json",
    }),
    body: new TextEncoder().encode(JSON.stringify(input.body)),
  };
}

function createTextDocument(text: string) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text,
          },
        ],
      },
    ],
  };
}

describe("AppendSessionLinkToJiraDocumentRequestMiddleware", () => {
  it("appends a rule and linked session paragraph to issue comment bodies", async () => {
    const request = createJiraRequest({
      method: "POST",
      pathname: "/rest/api/3/issue/MIS-123/comment",
      body: {
        body: createTextDocument("Looks good to me"),
      },
    });

    const result = await AppendSessionLinkToJiraDocumentRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request,
    });

    const decodedBody = new TextDecoder().decode(result.body);
    expect(JSON.parse(decodedBody)).toEqual({
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Looks good to me",
              },
            ],
          },
          {
            type: "rule",
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "🔗 View session",
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: SessionUrl,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  });

  it("appends the session footer to issue description updates and creation payloads", async () => {
    const updateRequest = createJiraRequest({
      method: "PUT",
      pathname: "/rest/api/3/issue/MIS-123",
      body: {
        fields: {
          description: createTextDocument("Expanded implementation notes"),
        },
      },
    });
    const createRequest = createJiraRequest({
      method: "POST",
      pathname: "/rest/api/3/issue",
      body: {
        fields: {
          description: createTextDocument("Fresh issue description"),
        },
      },
    });

    const updateResult = await AppendSessionLinkToJiraDocumentRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request: updateRequest,
    });
    const createResult = await AppendSessionLinkToJiraDocumentRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request: createRequest,
    });

    const updatedDescription = JSON.parse(new TextDecoder().decode(updateResult.body)).fields
      .description;
    const createdDescription = JSON.parse(new TextDecoder().decode(createResult.body)).fields
      .description;

    expect(updatedDescription.content).toHaveLength(3);
    expect(createdDescription.content).toHaveLength(3);
    expect(updatedDescription.content[1]).toEqual({ type: "rule" });
    expect(createdDescription.content[1]).toEqual({ type: "rule" });
  });

  it("does not append the footer twice when the linked session paragraph is already present", async () => {
    const request = createJiraRequest({
      method: "POST",
      pathname: "/rest/api/3/issue/MIS-123/comment",
      body: {
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Looks good to me",
                },
              ],
            },
            {
              type: "rule",
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "🔗 View session",
                  marks: [
                    {
                      type: "link",
                      attrs: {
                        href: SessionUrl,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });

    const result = await AppendSessionLinkToJiraDocumentRequestMiddleware.handle({
      ctx: {
        sandboxInstanceId: "sandbox_123",
        sessionUrl: SessionUrl,
      },
      request,
    });

    const decodedBody = new TextDecoder().decode(result.body);
    const parsedBody = JSON.parse(decodedBody);
    expect(parsedBody.body.content).toHaveLength(3);
  });
});
