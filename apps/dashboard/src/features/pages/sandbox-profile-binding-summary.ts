import {
  resolveBindingConfigSummaryItems,
  type BindingConfigSummaryItem,
  type IntegrationConnectionSummary,
  type IntegrationTargetSummary,
  type SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";

export type SandboxProfileBindingSummaryItem = BindingConfigSummaryItem;

export function formatSandboxProfileBindingSummaryItems(input: {
  row: SandboxProfileBindingEditorRow;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  maxItems?: number | undefined;
  excludedPropertyKeys?: readonly string[] | undefined;
}): SandboxProfileBindingSummaryItem[] {
  return resolveBindingConfigSummaryItems({
    row: input.row,
    connections: input.availableConnections,
    targets: input.availableTargets,
    ...(input.maxItems === undefined ? {} : { maxItems: input.maxItems }),
    ...(input.excludedPropertyKeys === undefined
      ? {}
      : { excludedPropertyKeys: input.excludedPropertyKeys }),
  });
}
