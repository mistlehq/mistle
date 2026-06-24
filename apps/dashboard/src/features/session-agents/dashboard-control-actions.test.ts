import { describe, expect, it } from "vitest";

import {
  createDashboardControlUserInputResponse,
  createDashboardControlUserInputServerRequest,
  DashboardControlDynamicToolSpecs,
  DashboardControlDynamicToolNamespace,
  DesignerBlueprintTabUpsertAction,
  DesignerCanvasTabShowDynamicToolName,
  DesignerCanvasTabShowDynamicToolSpec,
  DesignerCanvasTabOpenAction,
  DesignerUserInputRequestAction,
  DesignerUserInputRequestDynamicToolName,
  DesignerUserInputRequestDynamicToolSpec,
  parseDashboardControlDynamicToolCall,
} from "./dashboard-control-actions.js";

describe("dashboard control actions", () => {
  it("exposes a Designer canvas tab show dynamic tool spec", () => {
    expect(DesignerCanvasTabShowDynamicToolSpec).toMatchObject({
      namespace: DashboardControlDynamicToolNamespace,
      name: DesignerCanvasTabShowDynamicToolName,
      description:
        "Show a route or blueprint in the Designer canvas. The dashboard creates, replaces, or focuses the matching tab.",
      inputSchema: {
        properties: {
          tab: {
            oneOf: [
              {
                properties: {
                  kind: {
                    enum: ["route"],
                  },
                  href: {
                    description: "Dashboard-internal absolute path.",
                  },
                },
              },
              {
                properties: {
                  kind: {
                    enum: ["blueprint"],
                  },
                  blueprint: {
                    required: ["version", "title", "outcome", "items", "links", "actions"],
                    properties: {
                      version: {
                        enum: [1],
                      },
                      items: {
                        items: {
                          oneOf: [
                            {
                              properties: {
                                kind: {
                                  enum: ["agent_step", "workflow_output"],
                                },
                              },
                            },
                            {
                              properties: {
                                kind: {
                                  enum: ["trigger"],
                                },
                                integrationTargetKey: {
                                  description:
                                    "Stable Mistle integration target key, such as slack-default or github-cloud. Use only when the trigger source maps to a selected or known integration target.",
                                },
                                integrationLabel: {
                                  description:
                                    "Provider or integration label shown on the trigger, such as GitHub or Slack.",
                                },
                                eventLabel: {
                                  description:
                                    "Specific event shown on the trigger, such as PR opened or message received.",
                                },
                              },
                            },
                            {
                              properties: {
                                kind: {
                                  enum: ["routing_policy"],
                                },
                                rules: {
                                  items: {
                                    properties: {
                                      routeTo: {
                                        description:
                                          "Optional item id to route to. Must reference an item in blueprint.items.",
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          ],
                        },
                      },
                      links: {
                        items: {
                          properties: {
                            from: {
                              description:
                                "Source item id. Must reference an item in blueprint.items.",
                            },
                            kind: {
                              enum: [
                                "requires",
                                "triggers",
                                "configures",
                                "produces",
                                "confirms",
                                "routes_to",
                                "hands_off_to",
                                "uses",
                              ],
                            },
                          },
                        },
                      },
                      actions: {
                        items: {
                          properties: {
                            href: {
                              description:
                                "Dashboard-internal absolute path such as /integrations/linear.",
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    });
  });

  it("exposes a Designer user input dynamic tool spec", () => {
    expect(DashboardControlDynamicToolSpecs).toContain(DesignerUserInputRequestDynamicToolSpec);
    expect(DesignerUserInputRequestDynamicToolSpec).toMatchObject({
      namespace: DashboardControlDynamicToolNamespace,
      name: DesignerUserInputRequestDynamicToolName,
      description:
        "Ask the user exactly one setup question in the dashboard. Use this for Designer decisions that need a selectable choice or a short free-form response.",
      inputSchema: {
        properties: {
          options: {
            description:
              "Selectable options. Include the recommended option first when there is a recommendation.",
            maxItems: 6,
          },
          freeForm: {
            properties: {
              inputKind: {
                enum: ["input", "textarea"],
              },
            },
          },
        },
      },
    });
  });

  it("parses Designer canvas tab open dynamic tool calls", () => {
    const parsed = parseDashboardControlDynamicToolCall({
      namespace: DashboardControlDynamicToolNamespace,
      tool: DesignerCanvasTabShowDynamicToolName,
      arguments: {
        tab: {
          kind: "route",
          id: "integrations",
          title: "Integrations",
          href: "/integrations",
        },
      },
    });

    expect(parsed).toEqual({
      action: DesignerCanvasTabOpenAction,
      input: {
        kind: "route",
        id: "integrations",
        title: "Integrations",
        href: "/integrations",
      },
    });
  });

  it("parses Designer blueprint tab upsert dynamic tool calls", () => {
    const blueprint = {
      version: 1,
      title: "Issue triage blueprint",
      outcome: {
        label: "Route incoming issues",
      },
      items: [
        {
          id: "issue-opened",
          kind: "trigger",
          label: "GitHub issue trigger",
          integrationTargetKey: "github-cloud",
          integrationLabel: "GitHub",
          eventLabel: "Issue opened",
          state: "proposed",
        },
        {
          id: "classify-issue",
          kind: "agent_step",
          label: "Classify issue",
          state: "proposed",
        },
      ],
      links: [
        {
          from: "issue-opened",
          to: "classify-issue",
          kind: "triggers",
        },
      ],
      actions: [
        {
          id: "create-trigger",
          itemId: "issue-opened",
          kind: "open_trigger_create",
          label: "Create trigger",
          href: "/triggers/new",
        },
      ],
    };

    const parsed = parseDashboardControlDynamicToolCall({
      namespace: DashboardControlDynamicToolNamespace,
      tool: DesignerCanvasTabShowDynamicToolName,
      arguments: {
        tab: {
          kind: "blueprint",
          title: "Blueprint",
          blueprint,
        },
      },
    });

    expect(parsed).toEqual({
      action: DesignerBlueprintTabUpsertAction,
      input: {
        kind: "blueprint",
        title: "Blueprint",
        blueprint,
      },
    });
  });

  it("parses Designer user input dynamic tool calls", () => {
    const parsed = parseDashboardControlDynamicToolCall({
      namespace: DashboardControlDynamicToolNamespace,
      tool: DesignerUserInputRequestDynamicToolName,
      arguments: {
        header: "Sandbox profile",
        id: "profile-choice",
        question: "Which sandbox profile should run the triaging agent?",
        options: [
          {
            label: "ABC",
            description: "Recommended because it has the newer active version.",
          },
          {
            label: "Whapi Ver",
            description: "Use this if you want to keep the existing WhatsApp profile.",
          },
        ],
      },
    });

    expect(parsed).toEqual({
      action: DesignerUserInputRequestAction,
      input: {
        header: "Sandbox profile",
        id: "profile-choice",
        question: "Which sandbox profile should run the triaging agent?",
        options: [
          {
            label: "ABC",
            description: "Recommended because it has the newer active version.",
          },
          {
            label: "Whapi Ver",
            description: "Use this if you want to keep the existing WhatsApp profile.",
          },
        ],
      },
    });
  });

  it("maps Designer user input requests to server requests", () => {
    const serverRequest = createDashboardControlUserInputServerRequest({
      requestId: "request-1",
      userInput: {
        header: "Sandbox profile",
        id: "profile-choice",
        question: "Which sandbox profile should run the triaging agent?",
        options: [
          {
            label: "ABC",
            description: "Recommended because it has the newer active version.",
          },
        ],
      },
    });

    expect(serverRequest).toEqual({
      requestId: "request-1",
      method: "tool/requestUserInput",
      kind: "tool-user-input",
      questions: [
        {
          header: "Sandbox profile",
          id: "profile-choice",
          question: "Which sandbox profile should run the triaging agent?",
          options: [
            {
              label: "ABC",
              description: "Recommended because it has the newer active version.",
              isOther: false,
            },
          ],
        },
      ],
      status: "pending",
      responseErrorMessage: null,
    });
  });

  it("formats Designer user input responses for dynamic tool calls", () => {
    const response = createDashboardControlUserInputResponse({
      result: {
        answers: [
          {
            id: "profile-choice",
            value: "ABC",
          },
        ],
      },
    });

    expect(response).toEqual({
      contentItems: [
        {
          type: "inputText",
          text: JSON.stringify({
            answers: [
              {
                id: "profile-choice",
                value: "ABC",
              },
            ],
          }),
        },
      ],
      success: true,
    });
  });

  it("rejects blueprints with dangling action references", () => {
    const parsed = parseDashboardControlDynamicToolCall({
      namespace: DashboardControlDynamicToolNamespace,
      tool: DesignerCanvasTabShowDynamicToolName,
      arguments: {
        tab: {
          kind: "blueprint",
          title: "Blueprint",
          blueprint: {
            version: 1,
            title: "Invalid blueprint",
            outcome: {
              label: "Route incoming issues",
            },
            items: [],
            links: [],
            actions: [
              {
                id: "create-trigger",
                itemId: "missing",
                kind: "open_trigger_create",
                label: "Create trigger",
                href: "/triggers/new",
              },
            ],
          },
        },
      },
    });

    expect(parsed).toEqual({
      contentItems: [{ type: "inputText", text: "Designer canvas tab input is invalid." }],
      success: false,
    });
  });

  it("rejects non-dashboard hrefs", () => {
    const parsed = parseDashboardControlDynamicToolCall({
      namespace: DashboardControlDynamicToolNamespace,
      tool: DesignerCanvasTabShowDynamicToolName,
      arguments: {
        tab: {
          kind: "route",
          id: "external",
          title: "External",
          href: "https://example.com",
        },
      },
    });

    expect(parsed).toEqual({
      contentItems: [{ type: "inputText", text: "Designer canvas tab input is invalid." }],
      success: false,
    });
  });

  it("rejects Designer user input calls without an answer surface", () => {
    const parsed = parseDashboardControlDynamicToolCall({
      namespace: DashboardControlDynamicToolNamespace,
      tool: DesignerUserInputRequestDynamicToolName,
      arguments: {
        id: "profile-choice",
        question: "Which sandbox profile should run the triaging agent?",
      },
    });

    expect(parsed).toEqual({
      contentItems: [{ type: "inputText", text: "Designer user input request is invalid." }],
      success: false,
    });
  });
});
