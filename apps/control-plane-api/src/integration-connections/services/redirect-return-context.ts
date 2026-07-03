import { z } from "zod";

export const IntegrationRedirectReturnContextSchema = z
  .object({
    kind: z.literal("designer-canvas"),
    designerSessionId: z.string().min(1),
    canvasTabId: z.string().min(1),
  })
  .strict();

export type IntegrationRedirectReturnContext = z.infer<
  typeof IntegrationRedirectReturnContextSchema
>;

export function removeIntegrationRedirectReturnContextFromBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const nextBody: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key !== "returnContext") {
      nextBody[key] = value;
    }
  }

  return nextBody;
}

export function resolveRedirectSessionReturnContext(input: {
  designerReturnSessionId: string | null;
  designerReturnCanvasTabId: string | null;
}): IntegrationRedirectReturnContext | undefined {
  if (input.designerReturnSessionId === null && input.designerReturnCanvasTabId === null) {
    return undefined;
  }

  if (input.designerReturnSessionId === null || input.designerReturnCanvasTabId === null) {
    throw new Error("Integration redirect session has incomplete Designer return context.");
  }

  return {
    kind: "designer-canvas",
    designerSessionId: input.designerReturnSessionId,
    canvasTabId: input.designerReturnCanvasTabId,
  };
}

export function buildIntegrationCallbackDashboardPath(input: {
  defaultDashboardPath: string;
  designerCanvasHref: string;
  returnContext?: IntegrationRedirectReturnContext | undefined;
}): string {
  if (input.returnContext === undefined) {
    return input.defaultDashboardPath;
  }

  const queryParams = new URLSearchParams();
  queryParams.set("openCanvasHref", input.designerCanvasHref);
  queryParams.set("openCanvasTabId", input.returnContext.canvasTabId);

  return `/designer/${encodeURIComponent(input.returnContext.designerSessionId)}?${queryParams.toString()}`;
}
