import type {
  DesignerActionProposal,
  DesignerActionProposalResponse,
  DesignerActionRequestState,
  DesignerProviderActionProposal,
} from "../schemas.js";
import { designerProviderActionProposalSchema } from "../schemas.js";

export type DesignerActionProposalTranscriptTurn = {
  id: string;
  status: string | null;
  items: unknown[];
};

export function splitDesignerActionProposalsFromTranscriptTurns(
  turns: readonly { id: string; status: string | null; items: readonly unknown[] }[],
): {
  actionProposals: DesignerProviderActionProposal[];
  turns: DesignerActionProposalTranscriptTurn[];
} {
  const proposalEntriesById = new Map<
    string,
    {
      proposal: DesignerProviderActionProposal;
      lastSeenIndex: number;
    }
  >();
  const filteredTurns: DesignerActionProposalTranscriptTurn[] = [];
  let proposalIndex = 0;

  for (const turn of turns) {
    const filteredItems: unknown[] = [];

    for (const item of turn.items) {
      const proposal = designerProviderActionProposalSchema.safeParse(item);

      if (!proposal.success) {
        filteredItems.push(item);
        continue;
      }

      proposalEntriesById.set(proposal.data.id, {
        proposal: proposal.data,
        lastSeenIndex: proposalIndex,
      });
      proposalIndex += 1;
    }

    filteredTurns.push({
      id: turn.id,
      status: turn.status,
      items: filteredItems,
    });
  }

  return {
    actionProposals: [...proposalEntriesById.values()]
      .sort((left, right) => left.lastSeenIndex - right.lastSeenIndex)
      .map((entry) => entry.proposal),
    turns: filteredTurns,
  };
}

type DesignerActionProposalHydrationActionRequest = DesignerActionRequestState & {
  proposalId: string;
};

export function hydrateDesignerActionProposalsWithActionRequests(input: {
  actionRequests: readonly DesignerActionProposalHydrationActionRequest[];
  proposals: readonly DesignerProviderActionProposal[];
}): DesignerActionProposal[] {
  const actionRequestsByProposalId = new Map<
    string,
    DesignerActionProposalHydrationActionRequest
  >();
  for (const actionRequest of input.actionRequests) {
    actionRequestsByProposalId.set(actionRequest.proposalId, actionRequest);
  }

  return input.proposals.map((proposal) => {
    const actionRequest = actionRequestsByProposalId.get(proposal.id);
    if (actionRequest === undefined) {
      return {
        ...proposal,
        actionRequest: null,
      };
    }

    return {
      ...proposal,
      status: actionRequest.status,
      actionRequest: {
        id: actionRequest.id,
        status: actionRequest.status,
        failureCode: actionRequest.failureCode,
        failureMessage: actionRequest.failureMessage,
        operationResult: actionRequest.operationResult,
      },
    };
  });
}

export function createDesignerActionProposalResponsePrompt(input: {
  proposalId: string;
  response: DesignerActionProposalResponse;
}): string {
  const responsePayload = JSON.stringify({
    proposalId: input.proposalId,
    response: input.response,
  });

  return [
    "Designer action proposal response",
    "",
    responsePayload,
    "",
    "Record this response in the Designer conversation. Do not perform provider writes, publish, launch, or mutate target profile configuration from this response. Continue only within the current Designer planning boundary.",
  ].join("\n");
}
