export function TableListingFooter(input: {
  resultsCount?: React.ReactNode;
  pagination?: React.ReactNode;
}): React.JSX.Element | null {
  const hasResultsCount = input.resultsCount !== undefined && input.resultsCount !== null;
  const hasPagination = input.pagination !== undefined && input.pagination !== null;

  if (!hasResultsCount && !hasPagination) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">{hasResultsCount ? input.resultsCount : null}</div>
      {hasPagination ? input.pagination : null}
    </div>
  );
}
