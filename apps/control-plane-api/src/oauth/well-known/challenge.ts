export type OAuthBearerChallengeInput =
  | {
      kind: "missing_token";
      metadataUrl: string;
    }
  | {
      kind: "invalid_token";
      metadataUrl: string;
    }
  | {
      kind: "insufficient_scope";
      metadataUrl: string;
      requiredScopes: readonly string[];
    };

export function createOAuthBearerChallenge(input: OAuthBearerChallengeInput): string {
  const params =
    input.kind === "missing_token"
      ? [`resource_metadata="${input.metadataUrl}"`]
      : input.kind === "invalid_token"
        ? [`error="invalid_token"`, `resource_metadata="${input.metadataUrl}"`]
        : [
            `error="insufficient_scope"`,
            `scope="${input.requiredScopes.join(" ")}"`,
            `resource_metadata="${input.metadataUrl}"`,
          ];

  return `Bearer ${params.join(", ")}`;
}
