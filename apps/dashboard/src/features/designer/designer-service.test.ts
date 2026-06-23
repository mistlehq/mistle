import { describe, expect, it } from "vitest";

import { createPutDesignerSessionCanvasTabsRequestBody } from "./designer-service.js";

describe("createPutDesignerSessionCanvasTabsRequestBody", () => {
  it("preserves blueprint canvas tab payloads when saving Designer tabs", () => {
    const requestBody = createPutDesignerSessionCanvasTabsRequestBody({
      tabs: [
        {
          kind: "blueprint",
          id: "designer-blueprint-current",
          title: "Triaging Agent Blueprint",
          href: "/designer/blueprints/current",
          blueprint: {
            version: 1,
            title: "Triaging Agent Workflow",
            outcome: {
              label: "Triaged work items",
            },
            items: [
              {
                id: "classify_item",
                kind: "agent_step",
                label: "Classify item",
                state: "proposed",
              },
            ],
            links: [],
            actions: [],
          },
        },
      ],
    });

    expect(requestBody).toEqual({
      tabs: [
        {
          kind: "blueprint",
          id: "designer-blueprint-current",
          title: "Triaging Agent Blueprint",
          href: "/designer/blueprints/current",
          blueprint: {
            version: 1,
            title: "Triaging Agent Workflow",
            outcome: {
              label: "Triaged work items",
            },
            items: [
              {
                id: "classify_item",
                kind: "agent_step",
                label: "Classify item",
                state: "proposed",
              },
            ],
            links: [],
            actions: [],
          },
        },
      ],
    });
  });
});
