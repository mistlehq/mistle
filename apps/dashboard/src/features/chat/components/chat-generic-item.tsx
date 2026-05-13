import type { ChatGenericItemEntry, ChatSemanticGroupEntry } from "../chat-types.js";
import { ChatSemanticGroup } from "./chat-semantic-group.js";

type ChatGenericItemProps = {
  block: ChatGenericItemEntry;
};

function mapGenericItemToSemanticGroup(block: ChatGenericItemEntry): ChatSemanticGroupEntry {
  return {
    id: `${block.turnId}:generic:${block.id}`,
    turnId: block.turnId,
    kind: "semantic-group",
    semanticKind: "generic",
    status: block.status,
    displayKeys: {
      active: "generic.active",
      completed: "generic.done",
    },
    counts: null,
    items: [
      {
        id: block.id,
        sourceKind: "generic-item",
        label: block.title,
        detail: block.body,
        detailKind: "plain",
        command: null,
        output: block.detailsJson,
        status: block.status,
      },
    ],
  };
}

export function ChatGenericItem({ block }: ChatGenericItemProps): React.JSX.Element {
  return (
    <ChatSemanticGroup
      block={mapGenericItemToSemanticGroup(block)}
      isRespondingToServerRequest={false}
      onRespondToServerRequest={() => {}}
      pendingServerRequests={[]}
    />
  );
}
