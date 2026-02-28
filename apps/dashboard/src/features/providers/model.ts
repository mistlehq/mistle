export type ProviderStatus = "Connected" | "Error" | "Not connected";
export type ProviderConnectionState = "connected" | "error" | "disconnected";

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

export type ProviderAuthMethod = {
  id: string;
  label: string;
};

export type ProviderConnection = {
  id: string;
  displayName: string;
  state: ProviderConnectionState;
};

export type ProviderScaffoldEntry = {
  providerInstanceId: string;
  displayName: string;
  description: string;
  authMethods: readonly ProviderAuthMethod[];
  connections: readonly ProviderConnection[];
};

export type ConnectState = {
  canStart: boolean;
  errorMessage: string | null;
};

export type DisconnectConfirmationContent = {
  title: string;
  body: string;
  successToastMessage: string;
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

export function getProviderAuthMethods(input: {
  entries: readonly ProviderScaffoldEntry[];
  providerInstanceId: string;
}): readonly ProviderAuthMethod[] {
  const selected = input.entries.find(
    (entry) => entry.providerInstanceId === input.providerInstanceId,
  );

  if (selected === undefined) {
    throw new Error(`Provider scaffold entry was not found: ${input.providerInstanceId}`);
  }

  return selected.authMethods;
}

export function resolveAutoSelectedAuthMethod(input: {
  methods: readonly ProviderAuthMethod[];
  selectedAuthMethodId: string | null;
}): string | null {
  if (input.selectedAuthMethodId !== null) {
    return input.selectedAuthMethodId;
  }

  if (input.methods.length === 1) {
    return input.methods[0]?.id ?? null;
  }

  return null;
}

export function canStartConnection(input: {
  methods: readonly ProviderAuthMethod[];
  selectedAuthMethodId: string | null;
}): ConnectState {
  if (input.methods.length === 0) {
    return {
      canStart: false,
      errorMessage: "No supported auth methods are available for this provider instance.",
    };
  }

  if (input.methods.length > 1 && input.selectedAuthMethodId === null) {
    return {
      canStart: false,
      errorMessage: "Select an authentication method to continue.",
    };
  }

  return {
    canStart: true,
    errorMessage: null,
  };
}

export function buildDisconnectConfirmationContent(
  providerDisplayName: string,
): DisconnectConfirmationContent {
  return {
    title: `Disconnect ${providerDisplayName}?`,
    body: `Existing sandbox sessions that depend on ${providerDisplayName} will no longer be able to call it. Reconnecting ${providerDisplayName} will not restore access for those existing sessions. Only newly started sessions will use the reconnected provider.`,
    successToastMessage: "Provider disconnected",
  };
}

export function deriveProviderStatusFromConnections(input: {
  connections: readonly ProviderConnection[];
}): ProviderStatus {
  return deriveProviderStatus({
    connectionStates: input.connections.map((connection) => connection.state),
  });
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

export const PROVIDER_SCAFFOLD_ENTRIES: readonly ProviderScaffoldEntry[] = [
  {
    providerInstanceId: "openai",
    displayName: "OpenAI",
    description: "Primary LLM provider for assistant responses.",
    authMethods: [{ id: "openai-default", label: "API key" }],
    connections: [
      {
        id: "conn_openai_primary",
        displayName: "OpenAI production key",
        state: "connected",
      },
    ],
  },
  {
    providerInstanceId: "github",
    displayName: "GitHub",
    description: "Repository and pull request context provider.",
    authMethods: [
      { id: "github-oauth", label: "OAuth app" },
      { id: "github-app", label: "GitHub App installation" },
    ],
    connections: [
      {
        id: "conn_github_org",
        displayName: "Engineering org installation",
        state: "error",
      },
    ],
  },
  {
    providerInstanceId: "slack",
    displayName: "Slack",
    description: "Notification and inbound event provider.",
    authMethods: [{ id: "slack-oauth", label: "OAuth app" }],
    connections: [],
  },
];
