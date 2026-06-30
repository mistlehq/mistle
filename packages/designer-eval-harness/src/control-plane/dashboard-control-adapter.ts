import type { CodexJsonRpcServerRequest } from "@mistle/integrations-definitions/agent-runtimes/codex/server";

import {
  createDashboardControlUserInputResponse,
  DashboardControlDynamicToolRequestMethod,
  DesignerBlueprintTabUpsertAction,
  DesignerCanvasTabOpenAction,
  DesignerUserInputRequestAction,
  isDashboardControlDynamicToolCallRequest,
  parseDashboardControlDynamicToolCall,
  type DashboardControlDynamicToolCallResponse,
} from "../../../../apps/dashboard/src/features/session-agents/dashboard-control-actions.ts";
import type { DesignerEvalDashboardControlAction, DesignerEvalInputResponse } from "../types.ts";
import type { DesignerEvalApiClient } from "./api-client.ts";

export type DesignerEvalDashboardControlAdapter = {
  handleServerRequest: (request: CodexJsonRpcServerRequest) => Promise<{
    response: DashboardControlDynamicToolCallResponse;
    action: DesignerEvalDashboardControlAction;
  }>;
};

export function createDesignerEvalDashboardControlAdapter(input: {
  apiClient: DesignerEvalApiClient;
  designerSessionId: string;
  resolveUserInput: (request: unknown) => Promise<DesignerEvalInputResponse>;
  writeCanvasTabs: (tabs: readonly unknown[]) => Promise<void>;
}): DesignerEvalDashboardControlAdapter {
  let sequence = 0;
  const canvasTabs: unknown[] = [];

  return {
    handleServerRequest: async (request) => {
      sequence += 1;

      if (!isDashboardControlDynamicToolCallRequest(request)) {
        const response = createFailureResponse(
          `Unsupported server request '${request.method}'. Designer eval client supports only dashboard_control dynamic tool calls.`,
        );
        return {
          response,
          action: {
            sequence,
            kind: "unsupported",
            method: request.method,
            input: request.params,
            response,
          },
        };
      }

      const parsed = parseDashboardControlDynamicToolCall(request.params);
      if ("success" in parsed) {
        return {
          response: parsed,
          action: {
            sequence,
            kind: "unsupported",
            method: DashboardControlDynamicToolRequestMethod,
            input: request.params,
            response: parsed,
          },
        };
      }

      if (parsed.action === DesignerCanvasTabOpenAction) {
        canvasTabs.push(parsed.input);
        await input.writeCanvasTabs(canvasTabs);
        const response = createSuccessTextResponse("Designer canvas tab recorded.");
        return {
          response,
          action: {
            sequence,
            kind: "show_designer_canvas_tab",
            tabKind: "route",
            input: parsed.input,
            response,
          },
        };
      }

      if (parsed.action === DesignerBlueprintTabUpsertAction) {
        const tab = {
          kind: "blueprint",
          id: "designer-blueprint-current",
          title: parsed.input.title,
          href: "/designer/blueprints/current",
          blueprint: parsed.input.blueprint,
        };
        const nextTabs = [...canvasTabs.filter((candidate) => !isBlueprintTab(candidate)), tab];
        canvasTabs.splice(0, canvasTabs.length, ...nextTabs);
        await input.writeCanvasTabs(canvasTabs);
        const response = createSuccessTextResponse("Designer blueprint tab recorded.");
        return {
          response,
          action: {
            sequence,
            kind: "show_designer_canvas_tab",
            tabKind: "blueprint",
            input: parsed.input,
            response,
          },
        };
      }

      if (parsed.action === DesignerUserInputRequestAction) {
        const inputResponse = await input.resolveUserInput(parsed.input);
        const result = await resolveUserInputResponse({
          apiClient: input.apiClient,
          designerSessionId: input.designerSessionId,
          request: parsed.input,
          response: inputResponse,
        });
        const response = createDashboardControlUserInputResponse({ result });
        return {
          response,
          action: {
            sequence,
            kind: "request_user_input",
            inputId: parsed.input.id,
            input: parsed.input,
            response,
          },
        };
      }

      throw new Error("Unsupported dashboard control action.");
    },
  };
}

async function resolveUserInputResponse(input: {
  apiClient: DesignerEvalApiClient;
  designerSessionId: string;
  request: {
    submitAction?:
      | {
          kind: "saveSelectedProviderResourcesToSandboxProfileDraft";
          targetDraft: {
            profileId: string;
            version: number;
          };
          bindingIntent: string;
        }
      | undefined;
    resourceSelection?:
      | {
          connectionId: string;
          resourceKind: string;
        }
      | undefined;
  };
  response: DesignerEvalInputResponse;
}): Promise<unknown> {
  if (input.response.kind === "cancel") {
    return {
      decision: "cancel",
    };
  }
  if (input.response.kind === "customResponse") {
    return {
      customResponse: {
        text: input.response.text,
      },
    };
  }

  const answers = input.response.answers.map((answer) => ({
    id: answer.id,
    value: Array.isArray(answer.value) ? [...answer.value] : answer.value,
  }));

  if (input.request.submitAction?.kind !== "saveSelectedProviderResourcesToSandboxProfileDraft") {
    return {
      answers,
    };
  }
  if (input.request.resourceSelection === undefined) {
    throw new Error("Resource-selection submit action requires resource selection metadata.");
  }

  const selectedHandles = answers.flatMap((answer) =>
    Array.isArray(answer.value) ? answer.value : [],
  );
  const receipt = await input.apiClient.postJson(
    `/v1/designer/sessions/${encodeURIComponent(input.designerSessionId)}/dashboard-actions/save-selected-provider-resources`,
    {
      targetDraft: input.request.submitAction.targetDraft,
      connectionId: input.request.resourceSelection.connectionId,
      resourceKind: input.request.resourceSelection.resourceKind,
      selectedHandles,
      bindingIntent: input.request.submitAction.bindingIntent,
    },
  );

  return {
    answers: answers.map((answer) =>
      Array.isArray(answer.value)
        ? {
            ...answer,
            sideEffect: receipt,
          }
        : answer,
    ),
  };
}

function createSuccessTextResponse(text: string): DashboardControlDynamicToolCallResponse {
  return {
    success: true,
    contentItems: [
      {
        type: "inputText",
        text,
      },
    ],
  };
}

function createFailureResponse(text: string): DashboardControlDynamicToolCallResponse {
  return {
    success: false,
    contentItems: [
      {
        type: "inputText",
        text,
      },
    ],
  };
}

function isBlueprintTab(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "kind") === "blueprint" &&
    Reflect.get(value, "id") === "designer-blueprint-current"
  );
}
