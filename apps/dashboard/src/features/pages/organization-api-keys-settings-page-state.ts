export type RevokeApiKeyMutationState = {
  isPending: boolean;
  variables:
    | {
        apiKeyId: string;
      }
    | undefined;
};

export function resolveRevokingApiKeyId(state: RevokeApiKeyMutationState): string | null {
  if (!state.isPending) {
    return null;
  }

  return state.variables?.apiKeyId ?? null;
}
