import type { DiscoveredIntegrationResource } from "@mistle/integrations-core";
import { z } from "zod";

const DiscoveredIntegrationResourceSchema = z
  .object({
    externalId: z.string().min(1).optional(),
    handle: z.string().min(1),
    displayName: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();

export function validateDiscoveredResources(
  resources: ReadonlyArray<DiscoveredIntegrationResource>,
): ReadonlyArray<DiscoveredIntegrationResource> {
  const parsedResources = z.array(DiscoveredIntegrationResourceSchema).parse(resources);
  const seenHandles = new Set<string>();
  const seenExternalIds = new Set<string>();

  for (const resource of parsedResources) {
    if (seenHandles.has(resource.handle)) {
      throw new Error(`Provider returned duplicate resource handle '${resource.handle}'.`);
    }
    seenHandles.add(resource.handle);

    if (resource.externalId !== undefined) {
      if (seenExternalIds.has(resource.externalId)) {
        throw new Error(
          `Provider returned duplicate external resource id '${resource.externalId}'.`,
        );
      }
      seenExternalIds.add(resource.externalId);
    }
  }

  return parsedResources.map((resource) => ({
    ...(resource.externalId === undefined ? {} : { externalId: resource.externalId }),
    handle: resource.handle,
    displayName: resource.displayName,
    metadata: resource.metadata,
  }));
}
