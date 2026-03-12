import { SectionHeader } from "@mistle/ui";
import type { ReactNode } from "react";

type IntegrationSectionProps<Card> = {
  cards: readonly Card[];
  emptyStateMessage?: string;
  getCardKey: (card: Card) => string;
  renderTile: (card: Card) => ReactNode;
  title: string;
};

export function IntegrationSection<Card>(props: IntegrationSectionProps<Card>) {
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
              <div key={props.getCardKey(card)}>{props.renderTile(card)}</div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
