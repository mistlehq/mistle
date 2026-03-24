import { Button } from "@mistle/ui";

export function TablePagination(input: {
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  onPreviousPage: () => void;
  onNextPage: () => void;
  previousPageDisabled?: boolean;
  nextPageDisabled?: boolean;
}): React.JSX.Element | null {
  const hasAnyPagination = input.hasPreviousPage || input.hasNextPage;
  if (!hasAnyPagination) {
    return null;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        disabled={!input.hasPreviousPage || input.previousPageDisabled === true}
        onClick={input.onPreviousPage}
        type="button"
        variant="outline"
      >
        Previous
      </Button>
      <Button
        disabled={!input.hasNextPage || input.nextPageDisabled === true}
        onClick={input.onNextPage}
        type="button"
        variant="outline"
      >
        Next
      </Button>
    </div>
  );
}
