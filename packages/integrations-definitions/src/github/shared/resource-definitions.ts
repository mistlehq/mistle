import {
  IntegrationResourceSelectionModes,
  type IntegrationResourceDefinition,
} from "@mistle/integrations-core";

export const GitHubResourceDefinitions: ReadonlyArray<IntegrationResourceDefinition> = [
  {
    kind: "repository",
    selectionMode: IntegrationResourceSelectionModes.MULTI,
    bindingField: "repositories",
    displayName: "Repositories",
    description: "GitHub repositories accessible to this connection.",
  },
];
