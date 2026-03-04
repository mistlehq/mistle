import type { IntegrationBindingEditorUiProjection } from "../../ui/binding-editor-ui-contract.js";

export function projectGitHubBindingEditorUi(): IntegrationBindingEditorUiProjection {
  return {
    bindingEditor: {
      kind: "git",
      config: {
        mode: "static",
        variant: {
          fields: [
            {
              type: "string-array",
              key: "repositories",
              label: "Repositories",
              defaultValue: [],
              delimiter: ",",
              minItems: 1,
            },
          ],
        },
      },
    },
  };
}
