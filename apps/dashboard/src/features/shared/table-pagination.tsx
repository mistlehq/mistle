import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@mistle/ui";

const DisabledPaginationLinkClassName =
  "aria-disabled:pointer-events-none aria-disabled:opacity-50";

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

  const isPreviousDisabled = !input.hasPreviousPage || input.previousPageDisabled === true;
  const isNextDisabled = !input.hasNextPage || input.nextPageDisabled === true;

  function handlePreviousPageClick(event: React.MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault();
    if (isPreviousDisabled) {
      return;
    }

    input.onPreviousPage();
  }

  function handleNextPageClick(event: React.MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault();
    if (isNextDisabled) {
      return;
    }

    input.onNextPage();
  }

  return (
    <Pagination className="mx-0 w-auto justify-end">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            aria-disabled={isPreviousDisabled}
            className={DisabledPaginationLinkClassName}
            href="#"
            onClick={handlePreviousPageClick}
            tabIndex={isPreviousDisabled ? -1 : undefined}
          />
        </PaginationItem>
        <PaginationItem>
          <PaginationNext
            aria-disabled={isNextDisabled}
            className={DisabledPaginationLinkClassName}
            href="#"
            onClick={handleNextPageClick}
            tabIndex={isNextDisabled ? -1 : undefined}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
