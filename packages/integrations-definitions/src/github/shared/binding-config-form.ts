import type { ResolvedIntegrationForm } from "@mistle/integrations-core";

export const GitHubBindingConfigForm: ResolvedIntegrationForm = {
  schema: {
    properties: {
      repositories: {
        title: "Repositories",
        default: [],
      },
    },
  },
  uiSchema: {
    repositories: {
      "ui:widget": "comma-separated-string-array",
      "ui:options": {
        addLabel: "Repository",
        delimiter: ",",
        placeholder: "owner/repository, owner/another-repository",
      },
    },
  },
};
