export type AgentProviderAccess = {
  providerFamilyId: string;
  providerVariantId: string;
  apiBaseUrl: string;
  authScheme: "bearer";
  credentialResolver: {
    connectionId: string;
    secretType: string;
    slotKey?: string;
  };
  additionalHeaders?: Readonly<Record<string, string>>;
  allowedMethods: readonly ("GET" | "POST")[];
  allowedPathPrefixes: readonly string[];
  defaultModel: string;
  allowedModels: readonly string[];
  providerMetadata?: Readonly<Record<string, unknown>> | undefined;
};
