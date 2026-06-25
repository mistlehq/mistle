import type {
  PiExtensionUIRequest,
  PiExtensionUIResponseInput,
} from "@mistle/integrations-definitions/agent-runtimes/pi/client";

import type {
  PiExtensionUIConfirmRequestEntry,
  ServerRequestEntry,
  ToolRequestUserInputEntry,
} from "../../server-requests/index.js";

export type ExposedPiExtensionUIRequest = Extract<
  PiExtensionUIRequest,
  { method: "confirm" | "editor" | "input" | "select" }
>;

export function shouldExposePiExtensionUIRequest(
  request: PiExtensionUIRequest,
): request is ExposedPiExtensionUIRequest {
  return (
    request.method === "confirm" ||
    request.method === "select" ||
    request.method === "input" ||
    request.method === "editor"
  );
}

export function mapPiExtensionUIRequestsToServerRequests(
  pendingRequests: readonly ExposedPiExtensionUIRequest[],
): readonly ServerRequestEntry[] {
  const serverRequests: ServerRequestEntry[] = [];
  for (const request of pendingRequests) {
    if (request.method === "confirm") {
      serverRequests.push(mapPiConfirmRequest(request));
    } else {
      serverRequests.push(mapPiUserInputRequest(request));
    }
  }
  return serverRequests;
}

function mapPiConfirmRequest(
  request: Extract<PiExtensionUIRequest, { method: "confirm" }>,
): PiExtensionUIConfirmRequestEntry {
  return {
    requestId: request.id,
    method: "pi/extensionUi/confirm",
    kind: "pi-extension-ui-confirm",
    title: request.title,
    message: request.message,
    availableDecisions: ["confirm", "cancel"],
    status: "pending",
    responseErrorMessage: null,
  };
}

function mapPiUserInputRequest(
  request: Extract<PiExtensionUIRequest, { method: "editor" | "input" | "select" }>,
): ToolRequestUserInputEntry {
  if (request.method === "select") {
    return {
      requestId: request.id,
      method: "tool/requestUserInput",
      kind: "tool-user-input",
      questions: [
        {
          id: request.id,
          header: "Pi",
          question: request.title,
          options: request.options.map((option) => ({
            label: option,
            isOther: false,
          })),
        },
      ],
      status: "pending",
      responseErrorMessage: null,
    };
  }

  if (request.method === "editor") {
    return {
      requestId: request.id,
      method: "tool/requestUserInput",
      kind: "tool-user-input",
      questions: [
        {
          id: request.id,
          header: "Pi",
          question: request.title,
          options: [
            {
              label: "Response",
              defaultValue: request.prefill ?? "",
              inputKind: "textarea",
              isOther: true,
            },
          ],
        },
      ],
      status: "pending",
      responseErrorMessage: null,
    };
  }

  return {
    requestId: request.id,
    method: "tool/requestUserInput",
    kind: "tool-user-input",
    questions: [
      {
        id: request.id,
        header: "Pi",
        question: request.title,
        options: [
          {
            label: request.placeholder ?? "Response",
            isOther: true,
          },
        ],
      },
    ],
    status: "pending",
    responseErrorMessage: null,
  };
}

export function resolvePiExtensionUIResponse(input: {
  request: ExposedPiExtensionUIRequest;
  result: unknown;
}): PiExtensionUIResponseInput {
  if (input.request.method === "confirm") {
    const decision = readDecision({
      missingMessage: "Pi confirmation response is missing a decision.",
      result: input.result,
    });
    if (decision === "confirm") {
      return {
        requestId: input.request.id,
        confirmed: true,
      };
    }
    if (decision === "cancel") {
      return {
        requestId: input.request.id,
        confirmed: false,
      };
    }
    throw new Error("Pi confirmation response has an unsupported decision.");
  }

  if (
    input.request.method === "select" ||
    input.request.method === "input" ||
    input.request.method === "editor"
  ) {
    if (readDecision({ result: input.result }) === "cancel") {
      return {
        requestId: input.request.id,
        cancelled: true,
      };
    }
    const value = readSingleAnswerValue({
      requestId: input.request.id,
      result: input.result,
    });
    return {
      requestId: input.request.id,
      value,
    };
  }

  throw new Error("Pi extension UI response method is unsupported.");
}

function readDecision(input: { missingMessage?: string; result: unknown }): string | null {
  if (typeof input.result !== "object" || input.result === null || !("decision" in input.result)) {
    if (input.missingMessage !== undefined) {
      throw new Error(input.missingMessage);
    }
    return null;
  }
  return typeof input.result.decision === "string" ? input.result.decision : null;
}

function readSingleAnswerValue(input: { requestId: string; result: unknown }): string {
  if (
    typeof input.result !== "object" ||
    input.result === null ||
    !("answers" in input.result) ||
    !Array.isArray(input.result.answers) ||
    input.result.answers.length !== 1
  ) {
    throw new Error("Pi user input response requires one answer.");
  }
  const [answer] = input.result.answers;
  if (
    typeof answer !== "object" ||
    answer === null ||
    !("id" in answer) ||
    answer.id !== input.requestId ||
    !("value" in answer) ||
    typeof answer.value !== "string" ||
    answer.value.trim().length === 0
  ) {
    throw new Error("Pi user input response included an invalid answer.");
  }
  return answer.value;
}
