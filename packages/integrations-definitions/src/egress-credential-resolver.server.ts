import type {
  AnyIntegrationDefinition,
  EgressCredentialResolverRef,
  IntegrationEgressCredentialResolverSelectionInput,
} from "@mistle/integrations-core";

export function resolveDefinitionEgressCredentialResolver(input: {
  definition: Pick<AnyIntegrationDefinition, "resolveEgressCredentialResolver"> | undefined;
  selection: IntegrationEgressCredentialResolverSelectionInput;
}): Promise<EgressCredentialResolverRef> | EgressCredentialResolverRef {
  if (input.definition?.resolveEgressCredentialResolver === undefined) {
    return input.selection.defaultCredentialResolver;
  }

  return input.definition.resolveEgressCredentialResolver(input.selection);
}
