import { SectionBlock } from "@mistle/ui";
import type { ReactNode } from "react";

type IntegrationSectionProps<Card> = {
  cards: readonly Card[];
  emptyStateMessage?: string;
  getCardKey: (card: Card) => string;
  renderTile: (card: Card) => ReactNode;
  title: string;
};

export function IntegrationSection<Card>(
  props: IntegrationSectionProps<Card>,
): React.JSX.Element | null {
  if (props.cards.length === 0) {
    if (props.emptyStateMessage !== undefined) {
      return <SectionBlock emptyState={props.emptyStateMessage} title={props.title} />;
    }

    return null;
  }

  return (
    <SectionBlock title={props.title}>
      <div className="w-full max-w-6xl">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {props.cards.map((card) => (
            <div key={props.getCardKey(card)}>{props.renderTile(card)}</div>
          ))}
        </div>
      </div>
    </SectionBlock>
  );
}
