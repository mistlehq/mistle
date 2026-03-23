export function TableListingFooter(input: {
  summary?: React.ReactNode;
  pagination?: React.ReactNode;
}): React.JSX.Element | null {
  const hasSummary = input.summary !== undefined && input.summary !== null;
  const hasPagination = input.pagination !== undefined && input.pagination !== null;

  if (!hasSummary && !hasPagination) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">{hasSummary ? input.summary : null}</div>
      {hasPagination ? input.pagination : null}
    </div>
  );
}
