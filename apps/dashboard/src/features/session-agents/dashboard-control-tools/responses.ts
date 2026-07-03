import { z } from "zod";

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

export type DashboardControlDynamicToolCallResponse = z.output<
  typeof DashboardControlDynamicToolInputSchema
>;

export function createSuccessfulDashboardControlJsonResponse(
  payload: unknown,
): DashboardControlDynamicToolCallResponse {
  return createDashboardControlDynamicToolCallResponse({
    success: true,
    text: JSON.stringify(payload),
  });
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
