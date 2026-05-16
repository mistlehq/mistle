import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@mistle/ui";
import type { ReactNode } from "react";

export function CollectionEmptyState(input: {
  action: ReactNode;
  description: ReactNode;
  title: string;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <Empty className={input.className}>
      <EmptyHeader>
        <EmptyTitle>
          <h2>{input.title}</h2>
        </EmptyTitle>
        <EmptyDescription>{input.description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>{input.action}</EmptyContent>
    </Empty>
  );
}
