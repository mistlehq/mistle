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
  allowedMethods: readonly ("GET" | "POST")[];
  allowedPathPrefixes: readonly string[];
  defaultModel: string;
  allowedModels: readonly string[];
  providerMetadata?: Readonly<Record<string, unknown>> | undefined;
};
