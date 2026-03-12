import type {
  IntegrationConnectionResource,
  IntegrationConnectionResources,
} from "../integrations/integrations-service.js";

function createRepositoryResource(input: {
  id: string;
  handle: string;
  displayName: string;
}): IntegrationConnectionResource {
  return {
    id: input.id,
    familyId: "github",
    kind: "repository",
    handle: input.handle,
    displayName: input.displayName,
    status: "accessible",
    metadata: {},
  };
}

export const RepositoryItems = [
  createRepositoryResource({
    id: "repo_1",
    handle: "mistle/main-dashboard",
    displayName: "main-dashboard",
  }),
  createRepositoryResource({
    id: "repo_2",
    handle: "mistle/control-plane-api",
    displayName: "control-plane-api",
  }),
  createRepositoryResource({
    id: "repo_3",
    handle: "mistle/sandbox-runtime",
    displayName: "sandbox-runtime",
  }),
  createRepositoryResource({
    id: "repo_4",
    handle: "mistle/codex-bridge",
    displayName: "codex-bridge",
  }),
] as const satisfies readonly IntegrationConnectionResource[];

export function filterRepositoryItems(
  input: readonly IntegrationConnectionResource[],
  search: string,
): readonly IntegrationConnectionResource[] {
  const normalizedSearch = search.trim().toLowerCase();

  return normalizedSearch.length === 0
    ? input
    : input.filter((item) => item.handle.toLowerCase().includes(normalizedSearch));
}

export function resolveRepositorySearchTerms(
  input: readonly IntegrationConnectionResource[],
): string[] {
  const searchTerms = new Set<string>([""]);

  for (const item of input) {
    const handle = item.handle.toLowerCase();
    searchTerms.add(handle);

    for (const part of handle.split("/")) {
      searchTerms.add(part);

      for (const token of part.split("-")) {
        searchTerms.add(token);
      }
    }
  }

  return [...searchTerms];
}

export function createGithubRepositoryResources(input: {
  connectionId: string;
  items?: readonly IntegrationConnectionResource[];
}): IntegrationConnectionResources {
  return {
    connectionId: input.connectionId,
    familyId: "github",
    kind: "repository",
    syncState: "ready",
    lastSyncedAt: "2026-03-09T12:00:00.000Z",
    items: input.items ?? RepositoryItems,
  };
}
