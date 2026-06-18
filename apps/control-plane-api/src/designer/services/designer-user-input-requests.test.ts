import { describe, expect, it } from "vitest";

import { splitDesignerUserInputRequestsFromTranscriptTurns } from "./designer-user-input-requests.js";

describe("Designer user input requests", () => {
  it("extracts pending tool user input requests and keeps protocol items out of chat transcript items", () => {
    const chatItem = {
      id: "item_assistant_message",
      type: "agentMessage",
      text: "Which repository should I configure?",
    };
    const unsupportedRequest = {
      id: "request_unsupported",
      method: "tool/requestUserInput",
      params: {
        questions: [],
      },
    };
    const userInputRequest = {
      id: "request_repository",
      method: "tool/requestUserInput",
      params: {
        questions: [
          {
            header: "Provider",
            id: "repository",
            question: "Which repository should Designer configure?",
            options: [
              {
                label: "mistle/app",
                description: "Production app repository",
              },
              {
                label: "Other",
                isOther: true,
              },
            ],
          },
        ],
      },
    };

    expect(
      splitDesignerUserInputRequestsFromTranscriptTurns([
        {
          id: "turn_request",
          status: "running",
          items: [chatItem, userInputRequest, unsupportedRequest],
        },
      ]),
    ).toEqual({
      userInputRequests: [
        {
          requestId: "request_repository",
          method: "tool/requestUserInput",
          kind: "tool-user-input",
          questions: [
            {
              header: "Provider",
              id: "repository",
              question: "Which repository should Designer configure?",
              options: [
                {
                  label: "mistle/app",
                  description: "Production app repository",
                  isOther: false,
                },
                {
                  label: "Other",
                  description: null,
                  isOther: true,
                },
              ],
            },
          ],
          status: "pending",
          responseErrorMessage: null,
        },
      ],
      turns: [
        {
          id: "turn_request",
          status: "running",
          items: [chatItem, unsupportedRequest],
        },
      ],
    });
  });

  it("keeps only the latest request item for a repeated request id", () => {
    const firstRequest = {
      id: 9,
      method: "tool/requestUserInput",
      params: {
        questions: [
          {
            id: "repository",
            question: "Which repository?",
          },
        ],
      },
    };
    const repeatedRequest = {
      id: 9,
      method: "tool/requestUserInput",
      params: {
        questions: [
          {
            id: "repository",
            question: "Which repository should Designer configure?",
          },
        ],
      },
    };

    expect(
      splitDesignerUserInputRequestsFromTranscriptTurns([
        {
          id: "turn_first",
          status: "running",
          items: [firstRequest],
        },
        {
          id: "turn_repeated",
          status: "running",
          items: [repeatedRequest],
        },
      ]).userInputRequests,
    ).toEqual([
      {
        requestId: 9,
        method: "tool/requestUserInput",
        kind: "tool-user-input",
        questions: [
          {
            header: null,
            id: "repository",
            question: "Which repository should Designer configure?",
            options: [],
          },
        ],
        status: "pending",
        responseErrorMessage: null,
      },
    ]);
  });

  it("excludes requests resolved by serverRequest resolved notifications", () => {
    const userInputRequest = {
      id: "request_repository",
      method: "tool/requestUserInput",
      params: {
        questions: [
          {
            id: "repository",
            question: "Which repository?",
          },
        ],
      },
    };
    const resolvedNotification = {
      method: "serverRequest/resolved",
      params: {
        requestId: "request_repository",
      },
    };

    expect(
      splitDesignerUserInputRequestsFromTranscriptTurns([
        {
          id: "turn_request",
          status: "running",
          items: [userInputRequest],
        },
        {
          id: "turn_resolved",
          status: "completed",
          items: [resolvedNotification],
        },
      ]),
    ).toEqual({
      userInputRequests: [],
      turns: [
        {
          id: "turn_request",
          status: "running",
          items: [],
        },
        {
          id: "turn_resolved",
          status: "completed",
          items: [],
        },
      ],
    });
  });
});
