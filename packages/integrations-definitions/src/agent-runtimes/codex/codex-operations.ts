import {
  isSkillMentionName,
  selectedSkillMentionMatchesText,
  type SelectedSkillMention,
  type SkillMentionDescriptor,
} from "@mistle/integrations-core";
import { z } from "zod";

import { CodexJsonRpcClient } from "./codex-json-rpc.js";
import { isRecord } from "./is-record.js";

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

const ThreadResponseSchema = z.looseObject({
  thread: z.looseObject({
    id: z.string().min(1),
  }),
});

const ThreadSessionResponseSchema = ThreadResponseSchema.extend({
  cwd: z.string().min(1),
});

const TurnStartResponseSchema = z.looseObject({
  turn: z.looseObject({
    id: z.string().min(1),
    status: z.string().min(1),
  }),
});

const ReviewStartResponseSchema = TurnStartResponseSchema.extend({
  reviewThreadId: z.string().min(1),
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
      parentThreadId: z.string().nullable().optional(),
      threadSource: z.string().nullable().optional(),
      agentNickname: z.string().nullable().optional(),
      agentRole: z.string().nullable().optional(),
      source: z.unknown().optional(),
      cwd: z.string().min(1),
      updatedAt: z
        .number()
        .transform((epochSeconds) => epochSeconds * 1000)
        .optional(),
      createdAt: z
        .number()
        .transform((epochSeconds) => epochSeconds * 1000)
        .optional(),
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

const ThreadGoalStatusSchema = z.enum([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
]);

const ThreadGoalSchema = z.object({
  threadId: z.string().min(1),
  objective: z.string(),
  status: ThreadGoalStatusSchema,
  tokenBudget: z.number().nullable(),
  tokensUsed: z.number(),
  timeUsedSeconds: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const ThreadGoalGetResponseSchema = z.object({
  goal: ThreadGoalSchema.nullable(),
});

const ThreadGoalSetResponseSchema = z.object({
  goal: ThreadGoalSchema,
});

const ThreadGoalClearResponseSchema = z.object({
  cleared: z.boolean(),
});

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

const SkillsListResponseSchema = z.object({
  data: z.array(
    z.looseObject({
      cwd: z.string().min(1),
      skills: z.array(
        z.looseObject({
          name: z.string().min(1),
          description: z.string(),
          shortDescription: z.string().nullable().optional(),
          interface: z
            .looseObject({
              shortDescription: z.string().nullable().optional(),
            })
            .nullable()
            .optional(),
          path: z.string().min(1),
          enabled: z.boolean(),
        }),
      ),
      errors: z.array(
        z.looseObject({
          path: z.string(),
          message: z.string().min(1),
        }),
      ),
    }),
  ),
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
  parentThreadId: string | null;
  threadSource: string | null;
  isSubagent: boolean;
  agentNickname: string | null;
  agentRole: string | null;
  cwd: string;
  updatedAt: number | null;
  createdAt: number | null;
};

export function isCodexSubagentThread(thread: CodexThreadSummary): boolean {
  return thread.isSubagent;
}

function isCodexSubagentThreadSource(threadSource: string | null): boolean {
  return (
    threadSource !== null &&
    (threadSource === "subagent" ||
      threadSource === "memory_consolidation" ||
      threadSource.startsWith("subAgent"))
  );
}

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

export type CodexSkillSummary = {
  name: string;
  description: string;
  shortDescription: string | null;
  path: string;
  enabled: boolean;
};

export type CodexSkillsListEntry = {
  cwd: string;
  skills: readonly CodexSkillSummary[];
  errors: readonly {
    path: string;
    message: string;
  }[];
};

export type CodexThreadGoalStatus = z.infer<typeof ThreadGoalStatusSchema>;

export type CodexThreadGoal = z.infer<typeof ThreadGoalSchema>;

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

export type CodexTurnInputSkillItem = {
  type: "skill";
  name: string;
  path: string;
};

export type CodexTurnInputItem =
  | CodexTurnInputLocalImageItem
  | CodexTurnInputSkillItem
  | CodexTurnInputTextItem;

export type CodexTurnCollaborationModeSettings = {
  model: string;
  reasoningEffort: string | null;
  developerInstructions: string | null;
};

export type CodexTurnCollaborationModeKind = "default" | "plan";

export type CodexReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title: string | null }
  | { type: "custom"; instructions: string };

export type CodexThreadSessionResult = {
  threadId: string;
  cwd: string;
  response: unknown;
};

export function parseCodexThreadSessionResponse(input: {
  method: "thread/start" | "thread/resume" | "thread/fork";
  response: unknown;
}): { threadId: string; cwd: string } {
  const parsedResponse = ThreadSessionResponseSchema.safeParse(input.response);
  if (!parsedResponse.success) {
    throw new Error(
      `${input.method} response payload is invalid. Payload: ${JSON.stringify(input.response)}`,
    );
  }

  return {
    threadId: parsedResponse.data.thread.id,
    cwd: parsedResponse.data.cwd,
  };
}

type CodexTurnStartRequest = {
  threadId: string;
  input: readonly CodexTurnInputItem[];
  cwd?: string;
  collaborationMode?: {
    mode: CodexTurnCollaborationModeKind;
    settings: {
      model: string;
      reasoning_effort: string | null;
      developer_instructions: string | null;
    };
  };
};

export function buildCodexTurnInputItems(input: {
  text: string;
  attachments: readonly CodexTurnInputLocalImageItem[];
  selectedSkillMentions?: readonly SelectedSkillMention[];
  skills?: readonly SkillMentionDescriptor[];
}): readonly CodexTurnInputItem[] {
  const trimmedText = input.text.trim();
  const skillItems =
    trimmedText.length === 0
      ? []
      : resolveCodexTurnInputSkillItems({
          selectedSkillMentions: input.selectedSkillMentions ?? [],
          text: trimmedText,
          skills: input.skills ?? [],
        });
  const items: CodexTurnInputItem[] = [
    ...(trimmedText.length === 0
      ? []
      : [
          {
            type: "text" as const,
            text: trimmedText,
          },
        ]),
    ...skillItems,
    ...input.attachments,
  ];

  if (items.length === 0) {
    throw new Error("Provide text or at least one attachment before starting a turn.");
  }

  return items;
}

function resolveCodexTurnInputSkillItems(input: {
  selectedSkillMentions: readonly SelectedSkillMention[];
  text: string;
  skills: readonly SkillMentionDescriptor[];
}): readonly CodexTurnInputSkillItem[] {
  const selectedItems: CodexTurnInputSkillItem[] = [];
  const selectedPaths = new Set<string>();
  const skillsByName = buildUniqueCodexSkillMentionByName(input.skills);
  const skillsByPath = buildCodexSkillMentionBySourcePath(input.skills);

  for (const selectedMention of input.selectedSkillMentions) {
    const skill = skillsByPath.get(selectedMention.sourcePath);
    if (skill === undefined) {
      throw new Error(
        `Selected skill "$${selectedMention.name}" is no longer available. Re-select it or remove it.`,
      );
    }

    if (skill.name !== selectedMention.name) {
      throw new Error(
        `Selected skill "$${selectedMention.name}" has changed. Re-select it or remove it.`,
      );
    }

    if (!selectedSkillMentionMatchesText({ mention: selectedMention, text: input.text })) {
      throw new Error(
        `Selected skill "$${selectedMention.name}" no longer matches the submitted text. Re-select it or remove it.`,
      );
    }

    if (selectedPaths.has(skill.sourcePath)) {
      continue;
    }

    selectedPaths.add(skill.sourcePath);
    selectedItems.push({
      type: "skill",
      name: skill.name,
      path: skill.sourcePath,
    });
  }

  for (const token of input.text.split(/\s+/)) {
    if (!token.startsWith("$")) {
      continue;
    }

    const skillName = token.slice(1);
    if (!isSkillMentionName(skillName)) {
      continue;
    }

    const skill = skillsByName.get(skillName);
    if (skill === undefined || selectedPaths.has(skill.sourcePath)) {
      continue;
    }

    selectedPaths.add(skill.sourcePath);
    selectedItems.push({
      type: "skill",
      name: skill.name,
      path: skill.sourcePath,
    });
  }

  return selectedItems;
}

function buildUniqueCodexSkillMentionByName(
  skills: readonly SkillMentionDescriptor[],
): ReadonlyMap<string, SkillMentionDescriptor> {
  const skillsByName = new Map<string, SkillMentionDescriptor>();
  const ambiguousNames = new Set<string>();

  for (const skill of skills) {
    if (ambiguousNames.has(skill.name)) {
      continue;
    }

    if (skillsByName.has(skill.name)) {
      skillsByName.delete(skill.name);
      ambiguousNames.add(skill.name);
      continue;
    }

    skillsByName.set(skill.name, skill);
  }

  return skillsByName;
}

function buildCodexSkillMentionBySourcePath(
  skills: readonly SkillMentionDescriptor[],
): ReadonlyMap<string, SkillMentionDescriptor> {
  const skillsByPath = new Map<string, SkillMentionDescriptor>();

  for (const skill of skills) {
    skillsByPath.set(skill.sourcePath, skill);
  }

  return skillsByPath;
}

export function buildCodexTurnStartRequest(input: {
  threadId: string;
  input: readonly CodexTurnInputItem[];
  cwd?: string;
  collaborationMode?: CodexTurnCollaborationModeKind | undefined;
  collaborationModeSettings?: CodexTurnCollaborationModeSettings | undefined;
}): CodexTurnStartRequest {
  return {
    threadId: input.threadId,
    input: input.input,
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.collaborationModeSettings === undefined
      ? {}
      : {
          collaborationMode: {
            mode: input.collaborationMode ?? "default",
            settings: {
              model: input.collaborationModeSettings.model,
              reasoning_effort: input.collaborationModeSettings.reasoningEffort,
              developer_instructions: input.collaborationModeSettings.developerInstructions,
            },
          },
        }),
  };
}

export async function startCodexThread(input: {
  rpcClient: CodexJsonRpcClient;
  cwd?: string;
  model?: string;
  sessionStartSource?: "clear" | undefined;
}): Promise<CodexThreadSessionResult> {
  const requestParameters = {
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.sessionStartSource === undefined
      ? {}
      : { sessionStartSource: input.sessionStartSource }),
  };
  const response = await input.rpcClient.call("thread/start", requestParameters);

  const parsedResponse = parseCodexThreadSessionResponse({
    method: "thread/start",
    response,
  });

  return {
    threadId: parsedResponse.threadId,
    cwd: parsedResponse.cwd,
    response,
  };
}

export async function startCodexTurn(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
  input: readonly CodexTurnInputItem[];
  cwd?: string;
  collaborationMode?: CodexTurnCollaborationModeKind | undefined;
  collaborationModeSettings?: CodexTurnCollaborationModeSettings | undefined;
}): Promise<{ turnId: string; status: string; response: unknown }> {
  const response = await input.rpcClient.call("turn/start", buildCodexTurnStartRequest(input));

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

export async function startCodexReview(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
  target: CodexReviewTarget;
}): Promise<{ turnId: string; status: string; reviewThreadId: string; response: unknown }> {
  const response = await input.rpcClient.call("review/start", buildCodexReviewStartRequest(input));

  const parsedResponse = ReviewStartResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `review/start response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    turnId: parsedResponse.data.turn.id,
    status: parsedResponse.data.turn.status,
    reviewThreadId: parsedResponse.data.reviewThreadId,
    response,
  };
}

export function buildCodexReviewStartRequest(input: {
  threadId: string;
  target: CodexReviewTarget;
}): {
  threadId: string;
  target: CodexReviewTarget;
  delivery: "inline";
} {
  return {
    threadId: input.threadId,
    target: input.target,
    delivery: "inline",
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
}): Promise<{
  threadId: string;
  name: string | null;
  preview: string | null;
  turns: readonly CodexThreadReadTurn[];
  response: unknown;
}> {
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
    name: parsedResponse.data.thread.name ?? null,
    preview: parsedResponse.data.thread.preview ?? null,
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
  cwd?: string | null;
  cursor?: string | null;
  limit?: number;
  archived?: boolean;
  sortKey?: "created_at" | "updated_at";
}): Promise<{
  threads: readonly CodexThreadSummary[];
  nextCursor: string | null;
  response: unknown;
}> {
  const response = await input.rpcClient.call("thread/list", {
    cursor: input.cursor ?? null,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.archived === undefined ? {} : { archived: input.archived }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.sortKey === undefined ? {} : { sortKey: input.sortKey }),
    sourceKinds: AllCodexThreadSourceKinds,
  });

  const parsedThreadList = parseCodexThreadListResponse(response);
  return {
    threads: parsedThreadList.threads,
    nextCursor: parsedThreadList.nextCursor,
    response,
  };
}

export function parseCodexThreadListResponse(response: unknown): {
  threads: readonly CodexThreadSummary[];
  nextCursor: string | null;
} {
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
      parentThreadId: resolveCodexThreadListParentThreadId(thread),
      threadSource: resolveCodexThreadListThreadSource(thread),
      isSubagent: resolveCodexThreadListIsSubagent(thread),
      agentNickname: thread.agentNickname ?? resolveCodexThreadListSourceAgentNickname(thread),
      agentRole: thread.agentRole ?? resolveCodexThreadListSourceAgentRole(thread),
      cwd: thread.cwd,
      updatedAt: thread.updatedAt ?? null,
      createdAt: thread.createdAt ?? null,
    })),
    nextCursor: parsedResponse.data.nextCursor ?? null,
  };
}

function resolveCodexThreadListThreadSource(input: {
  threadSource?: string | null | undefined;
  source?: unknown;
}): string | null {
  return input.threadSource ?? resolveCodexThreadListSourceThreadSource(input.source);
}

function resolveCodexThreadListIsSubagent(input: {
  parentThreadId?: string | null | undefined;
  threadSource?: string | null | undefined;
  source?: unknown;
}): boolean {
  return (
    resolveCodexThreadListParentThreadId(input) !== null ||
    hasCodexThreadListSubAgentSource(input.source) ||
    isCodexSubagentThreadSource(input.threadSource ?? null)
  );
}

function resolveCodexThreadListParentThreadId(input: {
  parentThreadId?: string | null | undefined;
  source?: unknown;
}): string | null {
  return (
    input.parentThreadId ??
    readCodexThreadListSourceThreadSpawnString(input.source, "parent_thread_id")
  );
}

function resolveCodexThreadListSourceAgentNickname(input: { source?: unknown }): string | null {
  return readCodexThreadListSourceThreadSpawnString(input.source, "agent_nickname");
}

function resolveCodexThreadListSourceAgentRole(input: { source?: unknown }): string | null {
  return readCodexThreadListSourceThreadSpawnString(input.source, "agent_role");
}

function hasCodexThreadListSubAgentSource(source: unknown): boolean {
  if (!isRecord(source)) {
    return false;
  }

  return source["subAgent"] !== undefined;
}

function resolveCodexThreadListSourceThreadSource(source: unknown): string | null {
  if (!isRecord(source)) {
    return null;
  }

  const subAgentSource = source["subAgent"];
  if (typeof subAgentSource === "string") {
    return subAgentSource.length > 0 ? subAgentSource : "subagent";
  }

  if (!isRecord(subAgentSource)) {
    return null;
  }

  const otherSource = subAgentSource["other"];
  if (typeof otherSource === "string" && otherSource.length > 0) {
    return otherSource;
  }

  return "subagent";
}

function readCodexThreadListSourceThreadSpawnString(
  source: unknown,
  fieldName: string,
): string | null {
  if (!isRecord(source)) {
    return null;
  }

  const subAgentSource = source["subAgent"];
  if (!isRecord(subAgentSource)) {
    return null;
  }

  const threadSpawnSource = subAgentSource["thread_spawn"];
  if (!isRecord(threadSpawnSource)) {
    return null;
  }

  const value = threadSpawnSource[fieldName];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function resumeCodexThread(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
}): Promise<CodexThreadSessionResult> {
  const response = await input.rpcClient.call("thread/resume", {
    threadId: input.threadId,
  });

  const parsedResponse = parseCodexThreadSessionResponse({
    method: "thread/resume",
    response,
  });

  return {
    threadId: parsedResponse.threadId,
    cwd: parsedResponse.cwd,
    response,
  };
}

export async function forkCodexThread(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
}): Promise<CodexThreadSessionResult> {
  const response = await input.rpcClient.call("thread/fork", {
    threadId: input.threadId,
  });

  const parsedResponse = parseCodexThreadSessionResponse({
    method: "thread/fork",
    response,
  });

  return {
    threadId: parsedResponse.threadId,
    cwd: parsedResponse.cwd,
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

  const parsedResponse = ThreadResponseSchema.safeParse(response);
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

export async function getCodexThreadGoal(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
}): Promise<{ goal: CodexThreadGoal | null; response: unknown }> {
  const response = await input.rpcClient.call("thread/goal/get", {
    threadId: input.threadId,
  });

  const parsedResponse = ThreadGoalGetResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `thread/goal/get response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    goal: parsedResponse.data.goal,
    response,
  };
}

export async function setCodexThreadGoal(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
  objective?: string;
  status?: CodexThreadGoalStatus;
  tokenBudget?: number | null;
}): Promise<{ goal: CodexThreadGoal; response: unknown }> {
  const response = await input.rpcClient.call("thread/goal/set", {
    threadId: input.threadId,
    ...(input.objective === undefined ? {} : { objective: input.objective }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.tokenBudget === undefined ? {} : { tokenBudget: input.tokenBudget }),
  });

  const parsedResponse = ThreadGoalSetResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `thread/goal/set response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    goal: parsedResponse.data.goal,
    response,
  };
}

export async function clearCodexThreadGoal(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
}): Promise<{ cleared: boolean; response: unknown }> {
  const response = await input.rpcClient.call("thread/goal/clear", {
    threadId: input.threadId,
  });

  const parsedResponse = ThreadGoalClearResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `thread/goal/clear response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    cleared: parsedResponse.data.cleared,
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

  const parsedResponse = ThreadResponseSchema.safeParse(response);
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
  threadId?: string;
}): Promise<{
  features: readonly CodexExperimentalFeatureSummary[];
  nextCursor: string | null;
  response: unknown;
}> {
  const response = await input.rpcClient.call("experimentalFeature/list", {
    cursor: input.cursor ?? null,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
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

export function parseCodexSkillsListResponse(response: unknown): {
  data: readonly CodexSkillsListEntry[];
} {
  const parsedResponse = SkillsListResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(
      `skills/list response payload is invalid. Payload: ${JSON.stringify(response)}`,
    );
  }

  return {
    data: parsedResponse.data.data.map((entry) => ({
      cwd: entry.cwd,
      skills: entry.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        shortDescription: skill.interface?.shortDescription ?? skill.shortDescription ?? null,
        path: skill.path,
        enabled: skill.enabled,
      })),
      errors: entry.errors.map((errorInfo) => ({
        path: errorInfo.path,
        message: errorInfo.message,
      })),
    })),
  };
}

export async function listCodexSkills(input: {
  rpcClient: CodexJsonRpcClient;
  cwds: readonly string[];
  forceReload?: boolean;
}): Promise<{
  data: readonly CodexSkillsListEntry[];
  response: unknown;
}> {
  const response = await input.rpcClient.call("skills/list", {
    cwds: input.cwds,
    ...(input.forceReload === undefined ? {} : { forceReload: input.forceReload }),
  });

  const parsedResponse = parseCodexSkillsListResponse(response);

  return {
    data: parsedResponse.data,
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
