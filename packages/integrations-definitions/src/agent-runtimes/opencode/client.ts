import type { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import type {
  AgentPartInput,
  FilePartInput,
  GlobalEvent,
  GlobalHealthResponse,
  Message,
  OutputFormat,
  Part,
  PermissionRequest,
  PermissionRuleset,
  Provider,
  Session,
  SessionStatus,
  SubtaskPartInput,
  TextPartInput,
} from "@opencode-ai/sdk/v2";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

import { createOpenCodeProxyFetch } from "./proxy-fetch.js";

export type OpenCodeHealth = GlobalHealthResponse;
export type OpenCodeProviderSummary = Provider;
export type OpenCodeConfigProvidersResult = {
  providers: readonly OpenCodeProviderSummary[];
  default: Record<string, string>;
};
export type OpenCodeSessionSummary = Session;
export type OpenCodeSessionStatus = SessionStatus;
export type OpenCodeEvent = GlobalEvent;
export type OpenCodeMessage = Message;
export type OpenCodeMessagePart = Part;
export type OpenCodePermissionRequest = PermissionRequest;
export type OpenCodePromptPartInput =
  | AgentPartInput
  | FilePartInput
  | SubtaskPartInput
  | TextPartInput;

export type OpenCodeMessageWithParts = {
  info: Message;
  parts: readonly Part[];
};

export type OpenCodeListSessionsInput = {
  archived?: boolean | "false" | "true";
  cursor?: number;
  directory?: string;
  limit?: number;
  roots?: boolean | "false" | "true";
  search?: string;
  start?: number;
  workspace?: string;
};

export type OpenCodeCreateSessionInput = {
  agent?: string;
  directory?: string;
  model?: {
    id: string;
    providerID: string;
    variant?: string;
  };
  parentID?: string;
  permission?: PermissionRuleset;
  title?: string;
  workspace?: string;
  workspaceID?: string;
};

export type OpenCodeSendPromptInput = {
  agent?: string;
  directory?: string;
  format?: OutputFormat;
  messageId?: string;
  model?: {
    modelID: string;
    providerID: string;
  };
  noReply?: boolean;
  parts: readonly OpenCodePromptPartInput[];
  sessionId: string;
  system?: string;
  tools?: Record<string, boolean>;
  variant?: string;
  workspace?: string;
};

export type OpenCodePermissionResponseInput = {
  directory?: string;
  message?: string;
  requestId: string;
  response: "always" | "once" | "reject";
  workspace?: string;
};

export type OpenCodeSubscribeEventsInput = {
  onError?: (error: unknown) => void;
};

export type OpenCodeEventSubscription = AsyncIterable<OpenCodeEvent> & {
  close(): Promise<void>;
};

export type OpenCodeSessionClient = {
  abortSession(input: { directory?: string; sessionId: string; workspace?: string }): Promise<void>;
  close(): void;
  createSession(input?: OpenCodeCreateSessionInput): Promise<OpenCodeSessionSummary>;
  getSession(input: {
    directory?: string;
    sessionId: string;
    workspace?: string;
  }): Promise<OpenCodeSessionSummary>;
  health(): Promise<OpenCodeHealth>;
  listConfigProviders(input?: {
    directory?: string;
    workspace?: string;
  }): Promise<OpenCodeConfigProvidersResult>;
  listMessages(input: {
    before?: string;
    directory?: string;
    limit?: number;
    sessionId: string;
    workspace?: string;
  }): Promise<readonly OpenCodeMessageWithParts[]>;
  listPermissions(input?: {
    directory?: string;
    workspace?: string;
  }): Promise<readonly PermissionRequest[]>;
  listSessions(input?: OpenCodeListSessionsInput): Promise<readonly OpenCodeSessionSummary[]>;
  listSessionStatuses(input?: {
    directory?: string;
    workspace?: string;
  }): Promise<Readonly<Record<string, OpenCodeSessionStatus>>>;
  respondToPermission(input: OpenCodePermissionResponseInput): Promise<void>;
  sendPrompt(input: OpenCodeSendPromptInput): Promise<void>;
  subscribeEvents(input?: OpenCodeSubscribeEventsInput): Promise<OpenCodeEventSubscription>;
};

export type OpenCodeSessionClientInput = {
  transport: SandboxSessionTransport;
};

const OpenCodeSdkBaseUrl = "http://opencode.internal";

function assertNonEmptyString(value: string, name: string): void {
  if (value.length === 0) {
    throw new Error(`OpenCode ${name} must not be empty.`);
  }
}

function createEventSubscription(input: {
  abortController: AbortController;
  onClose: () => void;
  stream: AsyncGenerator<OpenCodeEvent, unknown, unknown>;
}): OpenCodeEventSubscription {
  let isClosed = false;

  return {
    async close(): Promise<void> {
      if (isClosed) {
        return;
      }
      isClosed = true;
      input.abortController.abort();
      await input.stream.return(undefined);
      input.onClose();
    },
    [Symbol.asyncIterator]() {
      return input.stream;
    },
  };
}

export function createOpenCodeSessionClient(
  input: OpenCodeSessionClientInput,
): OpenCodeSessionClient {
  const sdkClient = createOpencodeClient({
    baseUrl: OpenCodeSdkBaseUrl,
    fetch: createOpenCodeProxyFetch({
      transport: input.transport,
    }),
  });
  const activeSubscriptions = new Set<OpenCodeEventSubscription>();

  return {
    async abortSession(abortInput) {
      assertNonEmptyString(abortInput.sessionId, "session id");
      await sdkClient.session.abort(
        {
          sessionID: abortInput.sessionId,
          ...(abortInput.directory !== undefined ? { directory: abortInput.directory } : {}),
          ...(abortInput.workspace !== undefined ? { workspace: abortInput.workspace } : {}),
        },
        {
          throwOnError: true,
        },
      );
    },
    close() {
      for (const subscription of activeSubscriptions) {
        void subscription.close();
      }
      activeSubscriptions.clear();
    },
    async createSession(createInput = {}) {
      const result = await sdkClient.session.create(createInput, {
        throwOnError: true,
      });
      return result.data;
    },
    async getSession(getInput) {
      assertNonEmptyString(getInput.sessionId, "session id");
      const result = await sdkClient.session.get(
        {
          sessionID: getInput.sessionId,
          ...(getInput.directory !== undefined ? { directory: getInput.directory } : {}),
          ...(getInput.workspace !== undefined ? { workspace: getInput.workspace } : {}),
        },
        {
          throwOnError: true,
        },
      );
      return result.data;
    },
    async health() {
      const result = await sdkClient.global.health({
        throwOnError: true,
      });
      return result.data;
    },
    async listConfigProviders(listInput = {}) {
      const result = await sdkClient.config.providers(
        {
          ...(listInput.directory !== undefined ? { directory: listInput.directory } : {}),
          ...(listInput.workspace !== undefined ? { workspace: listInput.workspace } : {}),
        },
        {
          throwOnError: true,
        },
      );
      return result.data;
    },
    async listMessages(listInput) {
      assertNonEmptyString(listInput.sessionId, "session id");
      const result = await sdkClient.session.messages(
        {
          sessionID: listInput.sessionId,
          ...(listInput.before !== undefined ? { before: listInput.before } : {}),
          ...(listInput.directory !== undefined ? { directory: listInput.directory } : {}),
          ...(listInput.limit !== undefined ? { limit: listInput.limit } : {}),
          ...(listInput.workspace !== undefined ? { workspace: listInput.workspace } : {}),
        },
        {
          throwOnError: true,
        },
      );
      return result.data;
    },
    async listPermissions(listInput = {}) {
      const result = await sdkClient.permission.list(listInput, {
        throwOnError: true,
      });
      return result.data;
    },
    async listSessions(listInput = {}) {
      const result = await sdkClient.session.list(listInput, {
        throwOnError: true,
      });
      return result.data;
    },
    async listSessionStatuses(statusInput = {}) {
      const result = await sdkClient.session.status(statusInput, {
        throwOnError: true,
      });
      return result.data;
    },
    async respondToPermission(permissionInput) {
      assertNonEmptyString(permissionInput.requestId, "permission request id");
      await sdkClient.permission.reply(
        {
          requestID: permissionInput.requestId,
          reply: permissionInput.response,
          ...(permissionInput.directory !== undefined
            ? { directory: permissionInput.directory }
            : {}),
          ...(permissionInput.message !== undefined ? { message: permissionInput.message } : {}),
          ...(permissionInput.workspace !== undefined
            ? { workspace: permissionInput.workspace }
            : {}),
        },
        {
          throwOnError: true,
        },
      );
    },
    async sendPrompt(promptInput) {
      assertNonEmptyString(promptInput.sessionId, "session id");
      if (promptInput.parts.length === 0) {
        throw new Error("OpenCode prompt parts must not be empty.");
      }
      await sdkClient.session.promptAsync(
        {
          sessionID: promptInput.sessionId,
          parts: [...promptInput.parts],
          ...(promptInput.agent !== undefined ? { agent: promptInput.agent } : {}),
          ...(promptInput.directory !== undefined ? { directory: promptInput.directory } : {}),
          ...(promptInput.format !== undefined ? { format: promptInput.format } : {}),
          ...(promptInput.messageId !== undefined ? { messageID: promptInput.messageId } : {}),
          ...(promptInput.model !== undefined ? { model: promptInput.model } : {}),
          ...(promptInput.noReply !== undefined ? { noReply: promptInput.noReply } : {}),
          ...(promptInput.system !== undefined ? { system: promptInput.system } : {}),
          ...(promptInput.tools !== undefined ? { tools: promptInput.tools } : {}),
          ...(promptInput.variant !== undefined ? { variant: promptInput.variant } : {}),
          ...(promptInput.workspace !== undefined ? { workspace: promptInput.workspace } : {}),
        },
        {
          throwOnError: true,
        },
      );
    },
    async subscribeEvents(subscribeInput = {}) {
      const abortController = new AbortController();
      const eventResult = await sdkClient.global.event({
        signal: abortController.signal,
        sseMaxRetryAttempts: 1,
        ...(subscribeInput.onError !== undefined ? { onSseError: subscribeInput.onError } : {}),
      });
      const subscription = createEventSubscription({
        abortController,
        onClose: () => activeSubscriptions.delete(subscription),
        stream: eventResult.stream,
      });
      activeSubscriptions.add(subscription);
      return subscription;
    },
  };
}
