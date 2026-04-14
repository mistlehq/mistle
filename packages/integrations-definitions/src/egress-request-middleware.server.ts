import type {
  AnyIntegrationDefinition,
  IntegrationEgressRequestMiddleware,
} from "@mistle/integrations-core";

export function resolveDefinitionEgressRequestMiddleware(
  definition: Pick<AnyIntegrationDefinition, "egressRequestMiddleware"> | undefined,
  middlewareId: string,
): IntegrationEgressRequestMiddleware | undefined {
  return definition?.egressRequestMiddleware?.find((middleware) => middleware.id === middlewareId);
}
