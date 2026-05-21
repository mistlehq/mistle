import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@mistle/ui";

export function UnavailableResourceState(): React.JSX.Element {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>
          <h2>Page not found</h2>
        </EmptyTitle>
        <EmptyDescription>
          This page does not exist or you do not have access to it.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
