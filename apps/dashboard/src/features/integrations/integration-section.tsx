import type { ReactNode } from "react";

import { SectionHeader } from "../shared/section-header.js";
import type { IntegrationCardViewModel } from "./directory-model.js";

type IntegrationSectionProps = {
  cards: readonly IntegrationCardViewModel[];
  emptyStateMessage?: string;
  renderTile: (card: IntegrationCardViewModel) => ReactNode;
  title: string;
};

export function IntegrationSection(props: IntegrationSectionProps) {
  return (
    <div className="gap-2 flex flex-col">
      <SectionHeader title={props.title} />
      <div className="w-full max-w-6xl">
        {props.cards.length === 0 && props.emptyStateMessage ? (
          <p className="text-muted-foreground text-sm">{props.emptyStateMessage}</p>
        ) : null}
        {props.cards.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {props.cards.map((card) => (
              <div key={card.target.targetKey}>{props.renderTile(card)}</div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
