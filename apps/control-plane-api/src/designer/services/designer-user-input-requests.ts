import { z } from "zod";

import type { DesignerUserInputRequest } from "../schemas.js";

type DesignerUserInputRequestTranscriptTurn = {
  id: string;
  status: string | null;
  items: unknown[];
};

const ToolRequestUserInputOptionSchema = z.object({
  label: z.string().min(1).max(240),
  description: z.string().min(1).max(2_000).optional(),
  isOther: z.boolean().optional(),
});

const ToolRequestUserInputQuestionSchema = z.object({
  header: z.string().min(1).max(120).optional(),
  id: z.string().min(1).max(128),
  options: z.array(ToolRequestUserInputOptionSchema).max(12).optional(),
  question: z.string().min(1).max(2_000),
});

const ToolRequestUserInputSchema = z.object({
  id: z.union([z.number(), z.string().min(1)]),
  method: z.literal("tool/requestUserInput"),
  params: z.looseObject({
    questions: z.array(ToolRequestUserInputQuestionSchema).min(1).max(3),
  }),
});

const ServerRequestResolvedNotificationSchema = z.object({
  method: z.literal("serverRequest/resolved"),
  params: z.looseObject({
    requestId: z.union([z.number(), z.string().min(1)]).optional(),
    id: z.union([z.number(), z.string().min(1)]).optional(),
  }),
});

function hasMatchingRequestId(left: string | number, right: string | number): boolean {
  return String(left) === String(right);
}

function readResolvedRequestId(item: unknown): string | number | null {
  const resolved = ServerRequestResolvedNotificationSchema.safeParse(item);
  if (!resolved.success) {
    return null;
  }

  return resolved.data.params.requestId ?? resolved.data.params.id ?? null;
}

function toDesignerUserInputRequest(item: unknown): DesignerUserInputRequest | null {
  const request = ToolRequestUserInputSchema.safeParse(item);
  if (!request.success) {
    return null;
  }

  return {
    requestId: request.data.id,
    method: request.data.method,
    kind: "tool-user-input",
    questions: request.data.params.questions.map((question) => ({
      header: question.header ?? null,
      id: question.id,
      options: (question.options ?? []).map((option) => ({
        label: option.label,
        description: option.description ?? null,
        isOther: option.isOther ?? false,
      })),
      question: question.question,
    })),
    status: "pending",
    responseErrorMessage: null,
  };
}

export function splitDesignerUserInputRequestsFromTranscriptTurns(
  turns: readonly { id: string; status: string | null; items: readonly unknown[] }[],
): {
  userInputRequests: DesignerUserInputRequest[];
  turns: DesignerUserInputRequestTranscriptTurn[];
} {
  const requestsById = new Map<
    string,
    {
      request: DesignerUserInputRequest;
      lastSeenIndex: number;
    }
  >();
  const resolvedRequestIds: (string | number)[] = [];
  const filteredTurns: DesignerUserInputRequestTranscriptTurn[] = [];
  let requestIndex = 0;

  for (const turn of turns) {
    const filteredItems: unknown[] = [];

    for (const item of turn.items) {
      const request = toDesignerUserInputRequest(item);
      if (request !== null) {
        requestsById.set(String(request.requestId), {
          request,
          lastSeenIndex: requestIndex,
        });
        requestIndex += 1;
        continue;
      }

      const resolvedRequestId = readResolvedRequestId(item);
      if (resolvedRequestId !== null) {
        resolvedRequestIds.push(resolvedRequestId);
        continue;
      }

      filteredItems.push(item);
    }

    filteredTurns.push({
      id: turn.id,
      status: turn.status,
      items: filteredItems,
    });
  }

  const userInputRequests = [...requestsById.values()]
    .filter((entry) =>
      resolvedRequestIds.every(
        (resolvedRequestId) => !hasMatchingRequestId(entry.request.requestId, resolvedRequestId),
      ),
    )
    .sort((left, right) => left.lastSeenIndex - right.lastSeenIndex)
    .map((entry) => entry.request);

  return {
    userInputRequests,
    turns: filteredTurns,
  };
}
