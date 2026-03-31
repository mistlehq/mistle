import { z } from "zod";

import { CodexJsonRpcClient } from "./codex-json-rpc.js";

const AllCodexThreadSourceKinds = [
  "cli",
  "vscode",
  "exec",
  "appServer",
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
  "unknown",
] as const;

const ThreadStartResponseSchema = z.looseObject({
  thread: z.looseObject({
    id: z.string().min(1),
  }),
});

const TurnStartResponseSchema = z.looseObject({
  turn: z.looseObject({
    id: z.string().min(1),
    status: z.string().min(1),
  }),
});

const ThreadReadResponseSchema = z.looseObject({
  thread: z.looseObject({
    id: z.string().min(1),
    name: z.string().nullable().optional(),
    preview: z.string().optional(),
    turns: z
      .array(
        z.looseObject({
          id: z.string().min(1),
          status: z.string().min(1).optional(),
          items: z.array(z.unknown()).optional(),
        }),
      )
      .optional(),
  }),
});

const ThreadListResponseSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      id: z.string().min(1),
      name: z.string().nullable().optional(),
      preview: z.string().optional(),
      updatedAt: z.number().optional(),
      createdAt: z.number().optional(),
    }),
  ),
  nextCursor: z.string().nullable().optional(),
});

const ThreadLoadedListResponseSchema = z.object({
  data: z.array(z.string().min(1)),
});

const ThreadUnsubscribeResponseSchema = z.object({
  status: z.enum(["unsubscribed", "notSubscribed", "notLoaded"]),
});

const EmptyObjectResponseSchema = z.object({});

const ModelListResponseSchema = z.object({
  data: z.array(
    z.looseObject({
      id: z.string().min(1),
      model: z.string().min(1),
      displayName: z.string().min(1),
      hidden: z.boolean().optional(),
      defaultReasoningEffort: z.string().nullable().optional(),
      inputModalities: z.array(z.string()).optional(),
      supportsPersonality: z.boolean().optional(),
      isDefault: z.boolean().optional(),
    }),
  ),
  nextCursor: z.string().nullable().optional(),
});

const ExperimentalFeatureListResponseSchema = z.object({
  data: z.array(
    z.looseObject({
      name: z.string().min(1),
      stage: z.string().min(1),
      displayName: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      announcement: z.string().nullable().optional(),
      enabled: z.boolean().optional(),
      defaultEnabled: z.boolean().optional(),
    }),
  ),
  nextCursor: z.string().nullable().optional(),
});

const ConfigReadResponseSchema = z.looseObject({
  config: z.unknown(),
});

const ConfigRequirementsReadResponseSchema = z.looseObject({
  requirements: z.unknown().nullable().optional(),
});

const ExternalAgentConfigDetectResponseSchema = z.object({
  items: z.array(
    z.looseObject({
      itemType: z.string().min(1),
      description: z.string().min(1),
      cwd: z.string().nullable().optional(),
    }),
  ),
});

const TurnSteerResponseSchema = z.object({
  turnId: z.string().min(1),
});

export type CodexThreadReadTurn = {
  id: string;
  status: string | null;
  items: readonly unknown[];
};

export type CodexThreadSummary = {
  id: string;
  name: string | null;
  preview: string | null;
  updatedAt: number | null;
  createdAt: number | null;
};

export type CodexModelSummary = {
  id: string;
  model: string;
  displayName: string;
  hidden: boolean;
  defaultReasoningEffort: string | null;
  inputModalities: readonly string[];
  supportsPersonality: boolean;
  isDefault: boolean;
};

export type CodexExperimentalFeatureSummary = {
  name: string;
  stage: string;
  displayName: string | null;
  description: string | null;
  announcement: string | null;
  enabled: boolean | null;
  defaultEnabled: boolean | null;
};

export type CodexExternalAgentMigrationItem = {
  itemType: string;
  description: string;
  cwd: string | null;
};

export type CodexTurnInputTextItem = {
  type: "text";
  text: string;
};

export type CodexTurnInputLocalImageItem = {
  type: "localImage";
  path: string;
};

export type CodexTurnInputItem = CodexTurnInputLocalImageItem | CodexTurnInputTextItem;

export function buildCodexTurnInputItems(input: {
  text: string;
  attachments: readonly CodexTurnInputLocalImageItem[];
}): readonly CodexTurnInputItem[] {
  const trimmedText = input.text.trim();
  const items: CodexTurnInputItem[] = [
    ...(trimmedText.length === 0
      ? []
      : [
          {
            type: "text" as const,
            text: trimmedText,
          },
        ]),
    ...input.attachments,
  ];

  if (items.length === 0) {
    throw new Error("Provide text or at least one attachment before starting a turn.");
  }

  return items;
}

export async function startCodexThread(input: {
  rpcClient: CodexJsonRpcClient;
  model?: string;
}): Promise<{ threadId: string; response: unknown }> {
  const requestParameters =
    input.model === undefined
      ? {}
      : {
          model: input.model,
        };
  const response = await input.rpcClient.call("thread/start", requestParameters);

  const parsedResponse = ThreadStartResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `thread/start response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    threadId: parsedResponse.data.thread.id,
    response,
  };
}

export async function startCodexTurn(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
  input: readonly CodexTurnInputItem[];
}): Promise<{ turnId: string; status: string; response: unknown }> {
  const response = await input.rpcClient.call("turn/start", {
    threadId: input.threadId,
    input: input.input,
  });

  const parsedResponse = TurnStartResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(`turn/start response payload is invalid. Payload: ${JSON.stringify(response)}`);
  }

  return {
    turnId: parsedResponse.data.turn.id,
    status: parsedResponse.data.turn.status,
    response,
  };
}

export async function interruptCodexTurn(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
  turnId: string;
}): Promise<{ response: unknown }> {
  const response = await input.rpcClient.call("turn/interrupt", {
    threadId: input.threadId,
    turnId: input.turnId,
  });

  return {
    response,
  };
}

export async function steerCodexTurn(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
  turnId: string;
  input: readonly CodexTurnInputItem[];
}): Promise<{ turnId: string; response: unknown }> {
  const response = await input.rpcClient.call("turn/steer", {
    threadId: input.threadId,
    input: input.input,
    expectedTurnId: input.turnId,
  });

  const parsedResponse = TurnSteerResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(`turn/steer response payload is invalid. Payload: ${JSON.stringify(response)}`);
  }

  return {
    turnId: parsedResponse.data.turnId,
    response,
  };
}

export async function readCodexThread(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
}): Promise<{ threadId: string; turns: readonly CodexThreadReadTurn[]; response: unknown }> {
  const response = await input.rpcClient.call("thread/read", {
    threadId: input.threadId,
    includeTurns: true,
  });

  const parsedResponse = ThreadReadResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `thread/read response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    threadId: parsedResponse.data.thread.id,
    turns: (parsedResponse.data.thread.turns ?? []).map((turn) => ({
      id: turn.id,
      status: turn.status ?? null,
      items: turn.items ?? [],
    })),
    response,
  };
}

export async function listCodexThreads(input: {
  rpcClient: CodexJsonRpcClient;
  cursor?: string | null;
  limit?: number;
  archived?: boolean;
}): Promise<{
  threads: readonly CodexThreadSummary[];
  nextCursor: string | null;
  response: unknown;
}> {
  const response = await input.rpcClient.call("thread/list", {
    cursor: input.cursor ?? null,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.archived === undefined ? {} : { archived: input.archived }),
    sourceKinds: AllCodexThreadSourceKinds,
  });

  const parsedResponse = ThreadListResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `thread/list response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    threads: parsedResponse.data.data.map((thread) => ({
      id: thread.id,
      name: thread.name ?? null,
      preview: thread.preview ?? null,
      updatedAt: thread.updatedAt ?? null,
      createdAt: thread.createdAt ?? null,
    })),
    nextCursor: parsedResponse.data.nextCursor ?? null,
    response,
  };
}

export async function resumeCodexThread(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
}): Promise<{ threadId: string; response: unknown }> {
  const response = await input.rpcClient.call("thread/resume", {
    threadId: input.threadId,
  });

  const parsedResponse = ThreadStartResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `thread/resume response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    threadId: parsedResponse.data.thread.id,
    response,
  };
}

export async function forkCodexThread(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
}): Promise<{ threadId: string; response: unknown }> {
  const response = await input.rpcClient.call("thread/fork", {
    threadId: input.threadId,
  });

  const parsedResponse = ThreadStartResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `thread/fork response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    threadId: parsedResponse.data.thread.id,
    response,
  };
}

export async function listLoadedCodexThreads(input: {
  rpcClient: CodexJsonRpcClient;
}): Promise<{ threadIds: readonly string[]; response: unknown }> {
  const response = await input.rpcClient.call("thread/loaded/list", {});

  const parsedResponse = ThreadLoadedListResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `thread/loaded/list response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    threadIds: parsedResponse.data.data,
    response,
  };
}

export async function unsubscribeCodexThread(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
}): Promise<{ status: "unsubscribed" | "notSubscribed" | "notLoaded"; response: unknown }> {
  const response = await input.rpcClient.call("thread/unsubscribe", {
    threadId: input.threadId,
  });

  const parsedResponse = ThreadUnsubscribeResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `thread/unsubscribe response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    status: parsedResponse.data.status,
    response,
  };
}

export async function archiveCodexThread(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
}): Promise<{ response: unknown }> {
  const response = await input.rpcClient.call("thread/archive", {
    threadId: input.threadId,
  });

  const parsedResponse = EmptyObjectResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `thread/archive response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    response,
  };
}

export async function unarchiveCodexThread(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
}): Promise<{ threadId: string; response: unknown }> {
  const response = await input.rpcClient.call("thread/unarchive", {
    threadId: input.threadId,
  });

  const parsedResponse = ThreadStartResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `thread/unarchive response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    threadId: parsedResponse.data.thread.id,
    response,
  };
}

export async function compactCodexThread(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
}): Promise<{ response: unknown }> {
  const response = await input.rpcClient.call("thread/compact/start", {
    threadId: input.threadId,
  });

  const parsedResponse = EmptyObjectResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `thread/compact/start response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    response,
  };
}

export async function rollbackCodexThread(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
  numTurns: number;
}): Promise<{ threadId: string; response: unknown }> {
  const response = await input.rpcClient.call("thread/rollback", {
    threadId: input.threadId,
    numTurns: input.numTurns,
  });

  const parsedResponse = ThreadStartResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `thread/rollback response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    threadId: parsedResponse.data.thread.id,
    response,
  };
}

export async function listCodexModels(input: {
  rpcClient: CodexJsonRpcClient;
  cursor?: string | null;
  limit?: number;
  includeHidden?: boolean;
}): Promise<{
  models: readonly CodexModelSummary[];
  nextCursor: string | null;
  response: unknown;
}> {
  const response = await input.rpcClient.call("model/list", {
    cursor: input.cursor ?? null,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.includeHidden === undefined ? {} : { includeHidden: input.includeHidden }),
  });

  const parsedResponse = ModelListResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(`model/list response payload is invalid. Payload: ${JSON.stringify(response)}`);
  }

  return {
    models: parsedResponse.data.data.map((model) => ({
      id: model.id,
      model: model.model,
      displayName: model.displayName,
      hidden: model.hidden ?? false,
      defaultReasoningEffort: model.defaultReasoningEffort ?? null,
      inputModalities: model.inputModalities ?? ["text", "image"],
      supportsPersonality: model.supportsPersonality ?? false,
      isDefault: model.isDefault ?? false,
    })),
    nextCursor: parsedResponse.data.nextCursor ?? null,
    response,
  };
}

export async function listCodexExperimentalFeatures(input: {
  rpcClient: CodexJsonRpcClient;
  cursor?: string | null;
  limit?: number;
}): Promise<{
  features: readonly CodexExperimentalFeatureSummary[];
  nextCursor: string | null;
  response: unknown;
}> {
  const response = await input.rpcClient.call("experimentalFeature/list", {
    cursor: input.cursor ?? null,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });

  const parsedResponse = ExperimentalFeatureListResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `experimentalFeature/list response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    features: parsedResponse.data.data.map((feature) => ({
      name: feature.name,
      stage: feature.stage,
      displayName: feature.displayName ?? null,
      description: feature.description ?? null,
      announcement: feature.announcement ?? null,
      enabled: feature.enabled ?? null,
      defaultEnabled: feature.defaultEnabled ?? null,
    })),
    nextCursor: parsedResponse.data.nextCursor ?? null,
    response,
  };
}

export async function readCodexConfig(input: {
  rpcClient: CodexJsonRpcClient;
  includeLayers?: boolean;
}): Promise<{ config: unknown; response: unknown }> {
  const response = await input.rpcClient.call("config/read", {
    includeLayers: input.includeLayers ?? false,
  });

  const parsedResponse = ConfigReadResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `config/read response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    config: parsedResponse.data.config,
    response,
  };
}

export async function writeCodexConfigValue(input: {
  rpcClient: CodexJsonRpcClient;
  keyPath: string;
  value: unknown;
  mergeStrategy: "replace" | "upsert";
}): Promise<{ response: unknown }> {
  const response = await input.rpcClient.call("config/value/write", {
    keyPath: input.keyPath,
    value: input.value,
    mergeStrategy: input.mergeStrategy,
  });

  return {
    response,
  };
}

export async function batchWriteCodexConfig(input: {
  rpcClient: CodexJsonRpcClient;
  edits: readonly {
    keyPath: string;
    value: unknown;
    mergeStrategy: "replace" | "upsert";
  }[];
}): Promise<{ response: unknown }> {
  const response = await input.rpcClient.call("config/batchWrite", {
    edits: input.edits,
  });

  return {
    response,
  };
}

export async function readCodexConfigRequirements(input: {
  rpcClient: CodexJsonRpcClient;
}): Promise<{ requirements: unknown; response: unknown }> {
  const response = await input.rpcClient.call("configRequirements/read", {});

  const parsedResponse = ConfigRequirementsReadResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `configRequirements/read response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    requirements: parsedResponse.data.requirements ?? null,
    response,
  };
}

export async function detectExternalAgentConfig(input: {
  rpcClient: CodexJsonRpcClient;
  includeHome: boolean;
  cwds: readonly string[];
}): Promise<{ items: readonly CodexExternalAgentMigrationItem[]; response: unknown }> {
  const response = await input.rpcClient.call("externalAgentConfig/detect", {
    includeHome: input.includeHome,
    cwds: input.cwds,
  });

  const parsedResponse = ExternalAgentConfigDetectResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `externalAgentConfig/detect response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    items: parsedResponse.data.items.map((item) => ({
      itemType: item.itemType,
      description: item.description,
      cwd: item.cwd ?? null,
    })),
    response,
  };
}

export async function importExternalAgentConfig(input: {
  rpcClient: CodexJsonRpcClient;
  migrationItems: readonly CodexExternalAgentMigrationItem[];
}): Promise<{ response: unknown }> {
  const response = await input.rpcClient.call("externalAgentConfig/import", {
    migrationItems: input.migrationItems,
  });

  return {
    response,
  };
}
