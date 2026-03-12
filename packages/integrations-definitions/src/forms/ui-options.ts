export const IntegrationFieldLayouts = {
  STACKED: "stacked",
} as const;

export type IntegrationFieldLayout =
  (typeof IntegrationFieldLayouts)[keyof typeof IntegrationFieldLayouts];

export function createStackedFieldUiOptions(input?: { rows?: number | undefined }): {
  layout: IntegrationFieldLayout;
  rows?: number | undefined;
} {
  return {
    layout: IntegrationFieldLayouts.STACKED,
    ...(input?.rows === undefined ? {} : { rows: input.rows }),
  };
}
