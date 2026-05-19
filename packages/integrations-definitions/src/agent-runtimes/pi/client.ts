import { AgentStreamClient, type SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { z } from "zod";

const PiSessionStateSchema = z.looseObject({
  isStreaming: z.boolean(),
  isCompacting: z.boolean(),
  sessionFile: z.string().optional(),
  sessionId: z.string(),
  sessionName: z.string().optional(),
  messageCount: z.number(),
  pendingMessageCount: z.number(),
});

const PiProviderConversationResultSchema = z.object({
  providerConversationId: z.string(),
});

const PiReadMetadataResultSchema = z.object({
  name: z.string().nullable(),
  preview: z.string().nullable(),
});

export type PiSessionState = z.output<typeof PiSessionStateSchema>;

export type PiSessionClient = {
  close(): void;
  connect(): Promise<void>;
  createConversation(input: { cwd?: string }): Promise<{ providerConversationId: string }>;
  getState(input?: { sessionFile?: string }): Promise<PiSessionState>;
  readMetadata(input: {
    sessionFile: string;
  }): Promise<{ name: string | null; preview: string | null }>;
  resumeConversation(input: { sessionFile: string }): Promise<void>;
  setSessionName(input: { name: string; sessionFile: string }): Promise<void>;
  prompt(input: { message: string; sessionFile: string }): Promise<void>;
  steer(input: { message: string; sessionFile: string }): Promise<void>;
  followUp(input: { message: string; sessionFile: string }): Promise<void>;
  abort(input: { sessionFile: string }): Promise<void>;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export type PiSessionClientInput = {
  transport: SandboxSessionTransport;
};

function isJsonRpcErrorResponse(
  response: unknown,
): response is { error: { code: number; message: string; data?: unknown } } {
  const parsed = z
    .object({
      error: z.object({
        code: z.number(),
        message: z.string(),
        data: z.unknown().optional(),
      }),
    })
    .safeParse(response);
  return parsed.success;
}

export function createPiSessionClient(input: PiSessionClientInput): PiSessionClient {
  const agentStream = new AgentStreamClient({
    transport: input.transport,
  });
  const pendingRequests = new Map<string | number, PendingRequest>();
  let nextRequestId = 1;
  const unsubscribe = agentStream.onEvent((event) => {
    if (event.type !== "response") {
      return;
    }

    const pending = pendingRequests.get(event.response.id);
    if (pending === undefined) {
      return;
    }

    pendingRequests.delete(event.response.id);
    if (isJsonRpcErrorResponse(event.response)) {
      pending.reject(new Error(event.response.error.message));
      return;
    }

    pending.resolve(event.response.result);
  });

  async function request(input: { method: string; params?: unknown }): Promise<unknown> {
    const id = `pi_${String(nextRequestId)}`;
    nextRequestId += 1;
    const responsePromise = new Promise<unknown>((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
    });
    try {
      await agentStream.sendJson({
        jsonrpc: "2.0",
        id,
        method: input.method,
        ...(input.params === undefined ? {} : { params: input.params }),
      });
    } catch (error) {
      pendingRequests.delete(id);
      throw error;
    }
    return responsePromise;
  }

  function rejectPending(message: string): void {
    for (const pending of pendingRequests.values()) {
      pending.reject(new Error(message));
    }
    pendingRequests.clear();
  }

  agentStream.onEvent((event) => {
    if (event.type === "connection_state_changed" && event.state === "closed") {
      rejectPending(event.errorMessage ?? "Pi agent stream closed.");
    }
    if (event.type === "stream_reset") {
      rejectPending(event.resetInfo.message);
    }
  });

  return {
    async connect() {
      await agentStream.connect();
    },
    close() {
      unsubscribe();
      rejectPending("Pi session client closed.");
      agentStream.dispose();
    },
    async createConversation(createInput) {
      const result = await request({
        method: "pi/createConversation",
        params: createInput,
      });
      const created = PiProviderConversationResultSchema.parse(result);
      return {
        providerConversationId: created.providerConversationId,
      };
    },
    async getState(getStateInput = {}) {
      const result = await request({
        method: "pi/getState",
        params: getStateInput,
      });
      return PiSessionStateSchema.parse(result);
    },
    async readMetadata(readMetadataInput) {
      const result = await request({
        method: "pi/readMetadata",
        params: readMetadataInput,
      });
      return PiReadMetadataResultSchema.parse(result);
    },
    async resumeConversation(resumeInput) {
      await request({
        method: "pi/resumeConversation",
        params: resumeInput,
      });
    },
    async setSessionName(setSessionNameInput) {
      await request({
        method: "pi/setSessionName",
        params: setSessionNameInput,
      });
    },
    async prompt(promptInput) {
      await request({
        method: "pi/prompt",
        params: promptInput,
      });
    },
    async steer(steerInput) {
      await request({
        method: "pi/steer",
        params: steerInput,
      });
    },
    async followUp(followUpInput) {
      await request({
        method: "pi/followUp",
        params: followUpInput,
      });
    },
    async abort(abortInput) {
      await request({
        method: "pi/abort",
        params: abortInput,
      });
    },
  };
}
