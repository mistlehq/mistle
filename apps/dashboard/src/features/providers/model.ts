export type ProviderStatus = "Connected" | "Error" | "Not connected";

export type ProviderCatalogEntry = {
  providerInstanceId: string;
  displayName: string;
  description: string;
  status: ProviderStatus;
  authMethodLabels: string[];
};

export type ProviderCatalogStats = {
  totalProviders: number;
  connectedProviders: number;
  providersWithErrors: number;
};

export function deriveProviderStatus(input: {
  connectionStates: readonly string[];
}): ProviderStatus {
  for (const state of input.connectionStates) {
    if (state === "connected") {
      return "Connected";
    }
  }

  for (const state of input.connectionStates) {
    if (state === "error") {
      return "Error";
    }
  }

  return "Not connected";
}

export function summarizeProviderCatalog(
  entries: readonly ProviderCatalogEntry[],
): ProviderCatalogStats {
  let connectedProviders = 0;
  let providersWithErrors = 0;

  for (const entry of entries) {
    if (entry.status === "Connected") {
      connectedProviders += 1;
    } else if (entry.status === "Error") {
      providersWithErrors += 1;
    }
  }

  return {
    totalProviders: entries.length,
    connectedProviders,
    providersWithErrors,
  };
}

export const PROVIDER_CATALOG_UI_ENTRIES: readonly ProviderCatalogEntry[] = [
  {
    providerInstanceId: "openai",
    displayName: "OpenAI",
    description: "Primary LLM provider for assistant responses.",
    status: deriveProviderStatus({
      connectionStates: ["connected"],
    }),
    authMethodLabels: ["API key"],
  },
  {
    providerInstanceId: "github",
    displayName: "GitHub",
    description: "Repository and PR context provider.",
    status: deriveProviderStatus({
      connectionStates: ["error"],
    }),
    authMethodLabels: ["OAuth", "App installation"],
  },
  {
    providerInstanceId: "slack",
    displayName: "Slack",
    description: "Notification and inbound event provider.",
    status: deriveProviderStatus({
      connectionStates: [],
    }),
    authMethodLabels: ["OAuth"],
  },
];
