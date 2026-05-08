import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@mistle/ui";

const DisabledPaginationLinkClassName =
  "aria-disabled:pointer-events-none aria-disabled:opacity-50";

type TablePaginationLinkProps = {
  direction: "next" | "previous";
  disabled: boolean;
  onClick: () => void;
};

function TablePaginationLink(input: TablePaginationLinkProps): React.JSX.Element {
  function handleClick(event: React.MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault();
    if (input.disabled) {
      return;
    }

    input.onClick();
  }

  const PaginationControl = input.direction === "previous" ? PaginationPrevious : PaginationNext;

  return (
    <PaginationItem>
      <PaginationControl
        aria-disabled={input.disabled}
        className={DisabledPaginationLinkClassName}
        href="#"
        onClick={handleClick}
        tabIndex={input.disabled ? -1 : undefined}
      />
    </PaginationItem>
  );
}

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

  return (
    <Pagination className="mx-0 w-auto justify-end">
      <PaginationContent>
        <TablePaginationLink
          direction="previous"
          disabled={isPreviousDisabled}
          onClick={input.onPreviousPage}
        />
        <TablePaginationLink
          direction="next"
          disabled={isNextDisabled}
          onClick={input.onNextPage}
        />
      </PaginationContent>
    </Pagination>
  );
}
