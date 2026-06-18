import type { CodexDynamicToolSpec } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import type { CodexJsonRpcServerRequest } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { z } from "zod";

export const DesignerCanvasTabOpenAction = "designerCanvas.tabOpen";
export const DashboardControlDynamicToolRequestMethod = "item/tool/call";
export const DashboardControlDynamicToolNamespace = "dashboard_control";
export const DesignerCanvasTabOpenDynamicToolName = "open_designer_canvas_tab";

export type DashboardControlActionResult = {
  accepted: true;
};

const DesignerCanvasTabOpenInputSchema = z
  .object({
    id: z.string().min(1).max(128),
    title: z.string().min(1).max(120),
    href: z
      .string()
      .min(1)
      .max(2_048)
      .refine((href) => isDashboardInternalAbsolutePath(href), {
        message: "href must be a dashboard-internal absolute path.",
      }),
  })
  .strict();

const DashboardControlDynamicToolCallSchema = z
  .object({
    namespace: z.literal(DashboardControlDynamicToolNamespace),
    tool: z.literal(DesignerCanvasTabOpenDynamicToolName),
    arguments: DesignerCanvasTabOpenInputSchema,
  })
  .loose();

const DashboardControlDynamicToolCallIdentitySchema = z
  .object({
    namespace: z.string().nullable().optional(),
    tool: z.string().optional(),
  })
  .loose();

const DashboardControlDynamicToolInputSchema = z
  .object({
    contentItems: z.array(
      z.object({
        type: z.literal("inputText"),
        text: z.string(),
      }),
    ),
    success: z.boolean(),
  })
  .strict();

export type DesignerCanvasTabOpenInput = z.output<typeof DesignerCanvasTabOpenInputSchema>;
export type DashboardControlDynamicToolCallResponse = z.output<
  typeof DashboardControlDynamicToolInputSchema
>;

export type DashboardControlActionRequest = {
  action: typeof DesignerCanvasTabOpenAction;
  input: DesignerCanvasTabOpenInput;
};

export type DashboardControlActionHandler = (
  request: DashboardControlActionRequest,
) => DashboardControlActionResult;

export type DashboardControlActionSupport = {
  supportedActions: readonly string[];
  handleAction: DashboardControlActionHandler;
};

export const DesignerCanvasTabOpenDynamicToolSpec = {
  namespace: DashboardControlDynamicToolNamespace,
  name: DesignerCanvasTabOpenDynamicToolName,
  description: "Open and focus a dashboard-internal route in a Designer canvas tab.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      id: {
        type: "string",
        minLength: 1,
        maxLength: 128,
      },
      title: {
        type: "string",
        minLength: 1,
        maxLength: 120,
      },
      href: {
        type: "string",
        minLength: 1,
        maxLength: 2048,
        description: "Dashboard-internal absolute path.",
      },
    },
    required: ["id", "title", "href"],
  },
} satisfies CodexDynamicToolSpec;

export function isDashboardControlDynamicToolCallRequest(
  request: CodexJsonRpcServerRequest,
): request is CodexJsonRpcServerRequest & {
  method: typeof DashboardControlDynamicToolRequestMethod;
} {
  if (request.method !== DashboardControlDynamicToolRequestMethod) {
    return false;
  }

  const identity = DashboardControlDynamicToolCallIdentitySchema.safeParse(request.params);
  return (
    identity.success &&
    identity.data.namespace === DashboardControlDynamicToolNamespace &&
    identity.data.tool === DesignerCanvasTabOpenDynamicToolName
  );
}

export function parseDashboardControlDynamicToolCall(
  params: unknown,
): DashboardControlActionRequest | DashboardControlDynamicToolCallResponse {
  const parsedRequest = DashboardControlDynamicToolCallSchema.safeParse(params);
  if (!parsedRequest.success) {
    return createDashboardControlDynamicToolCallResponse({
      success: false,
      text: "Designer canvas tab input is invalid.",
    });
  }

  return {
    action: DesignerCanvasTabOpenAction,
    input: parsedRequest.data.arguments,
  };
}

export function createDashboardControlDynamicToolCallResponse(input: {
  success: boolean;
  text: string;
}): DashboardControlDynamicToolCallResponse {
  return {
    contentItems: [
      {
        type: "inputText",
        text: input.text,
      },
    ],
    success: input.success,
  };
}

function isDashboardInternalAbsolutePath(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) {
    return false;
  }

  try {
    const parsedUrl = new URL(href, "https://dashboard.mistle.local");
    return (
      parsedUrl.origin === "https://dashboard.mistle.local" &&
      `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}` === href
    );
  } catch {
    return false;
  }
}
