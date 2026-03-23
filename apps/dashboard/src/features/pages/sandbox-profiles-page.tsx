import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldLabel,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@mistle/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { formatSandboxProfileUpdatedAt } from "../sandbox-profiles/sandbox-profiles-formatters.js";
import { sandboxProfilesListQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  createSandboxProfile,
  listSandboxProfiles,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import { TableListingFooter } from "../shared/table-listing-footer.js";
import { TablePagination } from "../shared/table-pagination.js";

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

export function SandboxProfilesPage(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createProfileDisplayName, setCreateProfileDisplayName] = useState("");
  const [createProfileError, setCreateProfileError] = useState<string | null>(null);

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

  const createMutation = useMutation({
    mutationFn: async (displayName: string) =>
      createSandboxProfile({
        payload: {
          displayName,
        },
      }),
    onSuccess: async (createdProfile) => {
      setCreateProfileError(null);
      setCreateProfileDisplayName("");
      setIsCreateDialogOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ["sandbox-profiles"],
      });
      await navigate(`/sandbox-profiles/${createdProfile.id}`);
    },
    onError: (error: unknown) => {
      setCreateProfileError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not create sandbox profile.",
        }),
      );
    },
  });

  function openCreateDialog(): void {
    setCreateProfileDisplayName("");
    setCreateProfileError(null);
    setIsCreateDialogOpen(true);
  }

  function closeCreateDialog(): void {
    if (createMutation.isPending) {
      return;
    }

    setCreateProfileDisplayName("");
    setCreateProfileError(null);
    setIsCreateDialogOpen(false);
  }

  function onCreateProfileDisplayNameChange(nextValue: string): void {
    setCreateProfileDisplayName(nextValue);
    setCreateProfileError(null);
  }

  function createProfile(): void {
    const trimmedDisplayName = createProfileDisplayName.trim();
    if (trimmedDisplayName.length === 0 || createMutation.isPending) {
      return;
    }

    createMutation.mutate(trimmedDisplayName);
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
  const isCreateProfileInvalid = createProfileDisplayName.trim().length === 0;

  return (
    <div className="gap-4 flex flex-col">
      <div className="gap-3 flex flex-row items-start justify-between">
        <h1 className="text-xl font-semibold">Sandbox Profiles</h1>
        <Button onClick={openCreateDialog} type="button">
          Create profile
        </Button>
      </div>

      <Dialog
        isBusy={createMutation.isPending}
        isDismissible={!createMutation.isPending}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            openCreateDialog();
            return;
          }
          closeCreateDialog();
        }}
        open={isCreateDialogOpen}
      >
        <DialogContent>
          <DialogHeader variant="sectioned">
            <DialogTitle>Create profile</DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="create-profile-display-name">
              <span className="inline-flex items-center gap-0.5">
                Profile Name
                <span aria-hidden="true" className="text-destructive">
                  *
                </span>
              </span>
            </FieldLabel>
            <FieldContent>
              <Input
                autoFocus
                id="create-profile-display-name"
                onChange={(event) => {
                  onCreateProfileDisplayNameChange(event.currentTarget.value);
                }}
                value={createProfileDisplayName}
              />
            </FieldContent>
          </Field>
          {createProfileError ? (
            <p className="text-destructive text-sm">{createProfileError}</p>
          ) : null}
          <DialogFooter>
            <Button onClick={closeCreateDialog} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              disabled={isCreateProfileInvalid || createMutation.isPending}
              onClick={createProfile}
              type="button"
            >
              {createMutation.isPending ? "Creating..." : "Create profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {listQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load sandbox profiles</AlertTitle>
          <AlertDescription>
            {resolveApiErrorMessage({
              error: listQuery.error,
              fallbackMessage: "Could not load sandbox profiles.",
            })}
          </AlertDescription>
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
          <Table className="min-w-[32rem] table-fixed">
            <colgroup>
              <col className="w-[68%]" />
              <col className="w-[32%]" />
            </colgroup>
            <TableHeader className="bg-muted/60">
              <TableRow className="h-9 border-b">
                <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
                  Name
                </TableHead>
                <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
                  Updated
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((profile) => (
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
                  <TableCell className="text-muted-foreground text-sm">
                    {formatSandboxProfileUpdatedAt(profile.updatedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <TableListingFooter
            summary={
              <p className="text-muted-foreground text-sm">
                Showing {items.length} of {listQuery.data.totalResults}
              </p>
            }
            pagination={
              <TablePagination
                hasNextPage={listQuery.data.nextPage !== null}
                hasPreviousPage={listQuery.data.previousPage !== null}
                nextPageDisabled={listQuery.isFetching || listQuery.isPending}
                onNextPage={goToNextPage}
                onPreviousPage={goToPreviousPage}
                previousPageDisabled={listQuery.isFetching || listQuery.isPending}
              />
            }
          />
        </>
      ) : null}
    </div>
  );
}
