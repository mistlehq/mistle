import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogShortcut,
  DialogTitle,
  Field,
  FieldContent,
  FieldLabel,
  Input,
  Notice,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextLink,
} from "@mistle/ui";
import { PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SyntheticEvent } from "react";
import { useState } from "react";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { formatPublishedSandboxProfileVersionBadge } from "../sandbox-profiles/sandbox-profile-version-labels.js";
import { formatSandboxProfileUpdatedAt } from "../sandbox-profiles/sandbox-profiles-formatters.js";
import {
  sandboxProfilesListQueryKey,
  sandboxProvidersQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  createSandboxProfile,
  listSandboxProviders,
  listSandboxProfiles,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import { CollectionEmptyState } from "../shared/collection-empty-state.js";
import { PageFrame } from "../shared/page-frame.js";
import { readKeysetPaginationCursors } from "../shared/pagination-search-params.js";
import { TableListingFooter } from "../shared/table-listing-footer.js";
import { TablePagination } from "../shared/table-pagination.js";
import { createDefaultMistleSandboxRuntimeConfig } from "./sandbox-profile-runtime-defaults.js";
import type { CreateSandboxProfileDefaultRuntimeConfig } from "./sandbox-profile-runtime-defaults.js";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

function formatSandboxProfilePublicationStatus(activeVersion: number | null): string {
  return activeVersion === null
    ? "Not published"
    : formatPublishedSandboxProfileVersionBadge(activeVersion);
}

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

export function SandboxProfilesPage(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createProfileDisplayName, setCreateProfileDisplayName] = useState("");
  const [createProfileError, setCreateProfileError] = useState<string | null>(null);

  const limit = parseListLimit(searchParams.get("limit"));
  const { after, before } = readKeysetPaginationCursors(searchParams);

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
  const sandboxProvidersQuery = useQuery({
    queryKey: sandboxProvidersQueryKey(),
    queryFn: async ({ signal }) => listSandboxProviders({ signal }),
  });
  const defaultRuntimeConfig =
    sandboxProvidersQuery.data === undefined
      ? undefined
      : createDefaultMistleSandboxRuntimeConfig(sandboxProvidersQuery.data.items);

  type CreateProfileMutationInput = {
    defaultRuntimeConfig: CreateSandboxProfileDefaultRuntimeConfig;
    displayName: string;
  };

  const createMutation = useMutation({
    mutationFn: async (input: CreateProfileMutationInput) =>
      createSandboxProfile({
        payload: {
          displayName: input.displayName,
          sandboxProvider: input.defaultRuntimeConfig.sandboxProvider,
          sandboxResources: input.defaultRuntimeConfig.sandboxResources,
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

    if (defaultRuntimeConfig === undefined) {
      setCreateProfileError("Could not determine the Mistle sandbox provider for new profiles.");
      return;
    }

    createMutation.mutate({
      defaultRuntimeConfig,
      displayName: trimmedDisplayName,
    });
  }

  function handleCreateProfileSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    createProfile();
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
  const createProfileIsDisabled =
    isCreateProfileInvalid ||
    createMutation.isPending ||
    defaultRuntimeConfig === undefined ||
    sandboxProvidersQuery.isError;
  const hasNoProfiles = listQuery.data?.totalResults === 0;

  return (
    <PageFrame
      headerActions={
        <Button onClick={openCreateDialog} type="button">
          Create profile
        </Button>
      }
      title="Sandbox Profiles"
    >
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
        <DialogContent
          formProps={{
            className: "gap-6 grid",
            onSubmit: handleCreateProfileSubmit,
          }}
        >
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
          {sandboxProvidersQuery.isError ? (
            <Notice title="Could not load sandbox providers" variant="alert">
              {resolveApiErrorMessage({
                error: sandboxProvidersQuery.error,
                fallbackMessage: "Could not load sandbox providers.",
              })}
            </Notice>
          ) : null}
          {sandboxProvidersQuery.isSuccess && defaultRuntimeConfig === undefined ? (
            <Notice title="Mistle sandbox provider unavailable" variant="alert">
              No managed sandbox provider is configured for this deployment.
            </Notice>
          ) : null}
          <DialogFooter>
            <Button onClick={closeCreateDialog} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={createProfileIsDisabled} type="submit">
              {createMutation.isPending ? (
                "Creating..."
              ) : (
                <>
                  Create
                  <DialogShortcut aria-label="Enter" />
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {listQuery.isError ? (
        <Notice title="Could not load sandbox profiles" variant="alert">
          {resolveApiErrorMessage({
            error: listQuery.error,
            fallbackMessage: "Could not load sandbox profiles.",
          })}
        </Notice>
      ) : null}

      {!listQuery.isPending && !listQuery.isError ? (
        hasNoProfiles ? (
          <CollectionEmptyState
            action={
              <Button onClick={openCreateDialog} type="button">
                <PlusIcon aria-hidden className="size-4" />
                Create profile
              </Button>
            }
            description="Sandbox profiles define the environment agents use when starting sessions or running triggers."
            title="Create your first sandbox profile"
          />
        ) : (
          <>
            <Table className="min-w-[40rem]">
              <TableHeader className="bg-muted/60">
                <TableRow className="h-9 border-b">
                  <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
                    Name
                  </TableHead>
                  <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase whitespace-nowrap">
                    Status
                  </TableHead>
                  <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase whitespace-nowrap">
                    Updated
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((profile) => (
                  <TableRow key={profile.id}>
                    <TableCell className="whitespace-normal">
                      <TextLink
                        className="text-left break-words"
                        render={<RouterLink to={`/sandbox-profiles/${profile.id}`} />}
                        variant="listItem"
                      >
                        {profile.displayName}
                      </TextLink>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge
                        className={
                          profile.activeVersion === null
                            ? undefined
                            : "border-blue-200 bg-blue-50 text-blue-700"
                        }
                        variant={profile.activeVersion === null ? "outline" : "secondary"}
                      >
                        {formatSandboxProfilePublicationStatus(profile.activeVersion)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {formatSandboxProfileUpdatedAt(profile.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <TableListingFooter
              resultsCount={
                <p className="text-muted-foreground text-sm">
                  Showing {items.length} of {listQuery.data.totalResults}
                </p>
              }
              pagination={
                listQuery.data.nextPage === null && listQuery.data.previousPage === null ? null : (
                  <TablePagination
                    hasNextPage={listQuery.data.nextPage !== null}
                    hasPreviousPage={listQuery.data.previousPage !== null}
                    nextPageDisabled={listQuery.isFetching || listQuery.isPending}
                    onNextPage={goToNextPage}
                    onPreviousPage={goToPreviousPage}
                    previousPageDisabled={listQuery.isFetching || listQuery.isPending}
                  />
                )
              }
            />
          </>
        )
      ) : null}
    </PageFrame>
  );
}
