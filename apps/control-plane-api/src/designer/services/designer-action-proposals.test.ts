import { describe, expect, it } from "vitest";

import { splitDesignerActionProposalsFromTranscriptTurns } from "./designer-action-proposals.js";

const DesignerActionProposalItem = {
  id: "dap_github_webhook_setup",
  kind: "designerActionProposal",
  title: "Create GitHub webhook",
  summary: "Create a webhook on the selected repository for pull request events.",
  status: "pending",
  operation: {
    kind: "providerConfigurationChange",
    provider: "GitHub",
    resourceType: "repository webhook",
    resourceLabel: "mistle/agent-runtime",
    action: "create webhook",
    details: [
      {
        label: "Events",
        value: "pull_request, pull_request_review",
      },
    ],
  },
};

const ApprovedDesignerActionProposalItem = {
  ...DesignerActionProposalItem,
  status: "approved",
  summary: "The webhook was approved.",
};

describe("Designer action proposals", () => {
  it("extracts strictly shaped proposal items once and keeps them out of chat transcript items", () => {
    const chatItem = {
      id: "item_assistant_response",
      type: "agentMessage",
      text: "I can set that up after approval.",
    };
    const unsupportedProposal = {
      id: "dap_missing_operation",
      kind: "designerActionProposal",
      title: "Missing operation",
      summary: "This is not a valid proposal.",
      status: "pending",
    };
    const turns = [
      {
        id: "turn_initial",
        status: "completed",
        items: [chatItem, DesignerActionProposalItem, unsupportedProposal],
      },
      {
        id: "turn_duplicate",
        status: "completed",
        items: [ApprovedDesignerActionProposalItem],
      },
    ];

    expect(splitDesignerActionProposalsFromTranscriptTurns(turns)).toEqual({
      actionProposals: [ApprovedDesignerActionProposalItem],
      turns: [
        {
          id: "turn_initial",
          status: "completed",
          items: [chatItem, unsupportedProposal],
        },
        {
          id: "turn_duplicate",
          status: "completed",
          items: [],
        },
      ],
    });
  });
});
