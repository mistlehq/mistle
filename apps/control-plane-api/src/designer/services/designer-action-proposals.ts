import type { DesignerActionProposal, DesignerActionProposalResponse } from "../schemas.js";
import { designerActionProposalSchema } from "../schemas.js";

export type DesignerActionProposalTranscriptTurn = {
  id: string;
  status: string | null;
  items: unknown[];
};

export function splitDesignerActionProposalsFromTranscriptTurns(
  turns: readonly { id: string; status: string | null; items: readonly unknown[] }[],
): {
  actionProposals: DesignerActionProposal[];
  turns: DesignerActionProposalTranscriptTurn[];
} {
  const proposalEntriesById = new Map<
    string,
    {
      proposal: DesignerActionProposal;
      lastSeenIndex: number;
    }
  >();
  const filteredTurns: DesignerActionProposalTranscriptTurn[] = [];
  let proposalIndex = 0;

  for (const turn of turns) {
    const filteredItems: unknown[] = [];

    for (const item of turn.items) {
      const proposal = designerActionProposalSchema.safeParse(item);

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
