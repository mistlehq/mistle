import type { IntegrationConnectionResource } from "./integrations-service.js";

function createGitHubUserResource(input: {
  id: string;
  handle: string;
}): IntegrationConnectionResource {
  return {
    id: input.id,
    familyId: "github",
    kind: "user",
    handle: input.handle,
    displayName: input.handle,
    status: "accessible",
    metadata: {},
  };
}

export const GitHubUserStoryItems = Object.freeze([
  createGitHubUserResource({
    id: "github_user_1",
    handle: "jon-low",
  }),
  createGitHubUserResource({
    id: "github_user_2",
    handle: "mistle-reviewer",
  }),
  createGitHubUserResource({
    id: "github_user_3",
    handle: "octocat",
  }),
  createGitHubUserResource({
    id: "github_user_4",
    handle: "outside-collaborator",
  }),
]) satisfies readonly IntegrationConnectionResource[];
