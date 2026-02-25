export type KeysetPaginationQuery = {
  limit?: number;
  after?: string | undefined;
  before?: string | undefined;
};

export type KeysetNextPage = {
  after: string;
  limit: number;
};

export type KeysetPreviousPage = {
  before: string;
  limit: number;
};

export type KeysetPaginatedResult<TItem> = {
  totalResults: number;
  items: TItem[];
  nextPage: KeysetNextPage | null;
  previousPage: KeysetPreviousPage | null;
};
