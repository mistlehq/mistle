import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@mistle/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import {
  formatSandboxProfileStatus,
  formatSandboxProfileUpdatedAt,
  getSandboxProfileStatusBadgeUi,
} from "../sandbox-profiles/sandbox-profiles-formatters.js";
import { sandboxProfilesListQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { listSandboxProfiles } from "../sandbox-profiles/sandbox-profiles-service.js";
import { SESSION_QUERY_KEY } from "../shell/session-query.js";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

function parseListLimit(rawValue: string | null): number {
  if (rawValue === null) {
    return DEFAULT_LIST_LIMIT;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed)) {
    return DEFAULT_LIST_LIMIT;
  }

  if (parsed < 1 || parsed > MAX_LIST_LIMIT) {
    return DEFAULT_LIST_LIMIT;
  }

  return parsed;
}

function parseCursor(rawValue: string | null): string | null {
  if (rawValue === null) {
    return null;
  }

  const normalized = rawValue.trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof SandboxProfilesApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Could not load sandbox profiles.";
}

export function SandboxProfilesPage(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const limit = parseListLimit(searchParams.get("limit"));
  const after = parseCursor(searchParams.get("after"));
  const before = after === null ? parseCursor(searchParams.get("before")) : null;

  const listQuery = useQuery({
    queryKey: sandboxProfilesListQueryKey({
      limit,
      after,
      before,
    }),
    queryFn: async ({ signal }) =>
      listSandboxProfiles({
        limit,
        after,
        before,
        signal,
      }),
  });

  useEffect(() => {
    if (!listQuery.isError) {
      return;
    }

    const error = listQuery.error;
    if (!(error instanceof SandboxProfilesApiError)) {
      return;
    }

    if (error.status === 401) {
      void navigate("/auth/login", { replace: true });
      return;
    }

    if (error.status === 403) {
      void queryClient.invalidateQueries({
        queryKey: SESSION_QUERY_KEY,
      });
    }
  }, [listQuery.error, listQuery.isError, navigate, queryClient]);

  function navigateToCreateProfile(): void {
    void navigate("/sandbox-profiles/new");
  }

  function navigateToProfileDetail(profileId: string): void {
    void navigate(`/sandbox-profiles/${profileId}`);
  }

  function updatePagination(input: {
    nextLimit: number;
    nextAfter: string | null;
    nextBefore: string | null;
  }): void {
    const nextSearchParams = new URLSearchParams();
    nextSearchParams.set("limit", String(input.nextLimit));
    if (input.nextAfter !== null) {
      nextSearchParams.set("after", input.nextAfter);
    }
    if (input.nextBefore !== null) {
      nextSearchParams.set("before", input.nextBefore);
    }
    setSearchParams(nextSearchParams);
  }

  function goToNextPage(): void {
    const nextPage = listQuery.data?.nextPage;
    if (nextPage === null || nextPage === undefined) {
      return;
    }

    updatePagination({
      nextLimit: nextPage.limit,
      nextAfter: nextPage.after,
      nextBefore: null,
    });
  }

  function goToPreviousPage(): void {
    const previousPage = listQuery.data?.previousPage;
    if (previousPage === null || previousPage === undefined) {
      return;
    }

    updatePagination({
      nextLimit: previousPage.limit,
      nextAfter: null,
      nextBefore: previousPage.before,
    });
  }

  const items = listQuery.data?.items ?? [];

  return (
    <div className="gap-4 flex flex-col">
      <div className="gap-3 flex flex-row items-start justify-between">
        <h1 className="text-xl font-semibold">Sandbox Profiles</h1>
        <Button onClick={navigateToCreateProfile} type="button">
          Create profile
        </Button>
      </div>

      {listQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load sandbox profiles</AlertTitle>
          <AlertDescription>{toErrorMessage(listQuery.error)}</AlertDescription>
        </Alert>
      ) : null}

      {listQuery.isPending ? (
        <Card>
          <CardContent className="pt-4">
            <div className="gap-3 flex flex-col">
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!listQuery.isPending && !listQuery.isError ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((profile) => {
                const statusBadgeUi = getSandboxProfileStatusBadgeUi(profile.status);

                return (
                  <TableRow key={profile.id}>
                    <TableCell>
                      <button
                        className="text-left font-medium underline-offset-4 hover:underline"
                        onClick={() => {
                          navigateToProfileDetail(profile.id);
                        }}
                        type="button"
                      >
                        {profile.displayName}
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge className={statusBadgeUi.className} variant={statusBadgeUi.variant}>
                        {formatSandboxProfileStatus(profile.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatSandboxProfileUpdatedAt(profile.updatedAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">
              Showing {items.length} of {listQuery.data.totalResults}
            </p>
            <div className="gap-2 flex">
              <Button
                disabled={
                  listQuery.data.previousPage === null ||
                  listQuery.isFetching ||
                  listQuery.isPending
                }
                onClick={goToPreviousPage}
                type="button"
                variant="outline"
              >
                Previous
              </Button>
              <Button
                disabled={
                  listQuery.data.nextPage === null || listQuery.isFetching || listQuery.isPending
                }
                onClick={goToNextPage}
                type="button"
                variant="outline"
              >
                Next
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
