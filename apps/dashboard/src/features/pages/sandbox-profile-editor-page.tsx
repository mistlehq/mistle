import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Field,
  FieldContent,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@mistle/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

import type { SandboxProfileStatus } from "../sandbox-profiles/sandbox-profiles-types.js";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import {
  formatSandboxProfileStatus,
  isSandboxProfileStatus,
  SANDBOX_PROFILE_STATUS_OPTIONS,
} from "../sandbox-profiles/sandbox-profiles-formatters.js";
import {
  sandboxProfileDetailQueryKey,
  SANDBOX_PROFILES_QUERY_KEY_PREFIX,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  createSandboxProfile,
  getSandboxProfile,
  updateSandboxProfile,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import { SaveActions } from "../settings/save-actions.js";

type SandboxProfileEditorPageProps = {
  mode: "create" | "edit";
};

type SandboxProfileEditorFormState = {
  displayName: string;
  status: SandboxProfileStatus;
};

function parseStatusValue(value: string | null): SandboxProfileStatus {
  if (value === null) {
    throw new Error("Sandbox profile status must not be null.");
  }

  if (isSandboxProfileStatus(value)) {
    return value;
  }

  throw new Error(`Unsupported sandbox profile status: ${value}`);
}

export function SandboxProfileEditorPage(props: SandboxProfileEditorPageProps): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams();
  const profileId = params["profileId"];

  const [formState, setFormState] = useState<SandboxProfileEditorFormState>({
    displayName: "",
    status: "active",
  });
  const [persistedFormState, setPersistedFormState] = useState<SandboxProfileEditorFormState>({
    displayName: "",
    status: "active",
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const profileQuery = useQuery({
    queryKey:
      props.mode === "edit" && profileId !== undefined
        ? sandboxProfileDetailQueryKey(profileId)
        : sandboxProfileDetailQueryKey("missing-profile-id"),
    queryFn: async ({ signal }) => {
      if (profileId === undefined) {
        throw new Error("profileId is required.");
      }

      return getSandboxProfile({ profileId, signal });
    },
    enabled: props.mode === "edit",
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: async (input: SandboxProfileEditorFormState) =>
      createSandboxProfile({
        payload: {
          displayName: input.displayName,
          status: input.status,
        },
      }),
    onSuccess: async (createdProfile) => {
      setSaveError(null);
      await queryClient.invalidateQueries({
        queryKey: SANDBOX_PROFILES_QUERY_KEY_PREFIX,
      });
      await navigate(`/sandbox-profiles/${createdProfile.id}`);
    },
    onError: (error: unknown) => {
      setSaveError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not create sandbox profile.",
        }),
      );
      setSaveSuccess(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (input: { profileId: string; changes: SandboxProfileEditorFormState }) =>
      updateSandboxProfile({
        payload: {
          profileId: input.profileId,
          displayName: input.changes.displayName,
          status: input.changes.status,
        },
      }),
    onSuccess: async (updatedProfile) => {
      const latestState: SandboxProfileEditorFormState = {
        displayName: updatedProfile.displayName,
        status: updatedProfile.status,
      };

      setFormState(latestState);
      setPersistedFormState(latestState);
      setSaveError(null);
      setSaveSuccess(true);

      await queryClient.invalidateQueries({
        queryKey: SANDBOX_PROFILES_QUERY_KEY_PREFIX,
      });
      await queryClient.invalidateQueries({
        queryKey: sandboxProfileDetailQueryKey(updatedProfile.id),
      });
    },
    onError: (error: unknown) => {
      setSaveError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not update sandbox profile.",
        }),
      );
      setSaveSuccess(false);
    },
  });

  useEffect(() => {
    if (props.mode !== "edit") {
      return;
    }

    if (!profileQuery.data) {
      return;
    }

    const loadedState: SandboxProfileEditorFormState = {
      displayName: profileQuery.data.displayName,
      status: profileQuery.data.status,
    };

    setFormState(loadedState);
    setPersistedFormState(loadedState);
  }, [profileQuery.data, props.mode]);

  const trimmedDisplayName = formState.displayName.trim();
  const editTitleProfileName =
    trimmedDisplayName.length > 0 ? trimmedDisplayName : (profileId ?? "Profile");
  const pageTitle =
    props.mode === "create" ? "Create Profile" : `Sandbox Profile: ${editTitleProfileName}`;
  const isDisplayNameInvalid = trimmedDisplayName.length === 0;
  const hasEditChanges =
    trimmedDisplayName !== persistedFormState.displayName.trim() ||
    formState.status !== persistedFormState.status;

  function handleDisplayNameChange(nextValue: string): void {
    setFormState((currentState) => ({
      ...currentState,
      displayName: nextValue,
    }));
    setSaveError(null);
    setSaveSuccess(false);
  }

  function handleStatusChange(nextValue: string | null): void {
    const nextStatus = parseStatusValue(nextValue);
    setFormState((currentState) => ({
      ...currentState,
      status: nextStatus,
    }));
    setSaveError(null);
    setSaveSuccess(false);
  }

  function handleCancel(): void {
    if (props.mode === "create") {
      void navigate("/sandbox-profiles");
      return;
    }

    setFormState(persistedFormState);
    setSaveError(null);
    setSaveSuccess(false);
  }

  function handleCreate(): void {
    if (isDisplayNameInvalid || createMutation.isPending) {
      return;
    }

    createMutation.mutate({
      displayName: trimmedDisplayName,
      status: formState.status,
    });
  }

  function handleSave(): void {
    if (
      props.mode !== "edit" ||
      profileId === undefined ||
      !hasEditChanges ||
      isDisplayNameInvalid ||
      updateMutation.isPending
    ) {
      return;
    }

    updateMutation.mutate({
      profileId,
      changes: {
        displayName: trimmedDisplayName,
        status: formState.status,
      },
    });
  }

  if (props.mode === "edit" && profileQuery.isPending) {
    return (
      <div className="gap-4 flex flex-col">
        <h1 className="text-xl font-semibold">{pageTitle}</h1>
        <Card>
          <CardContent className="pt-4">
            <div className="gap-3 flex flex-col">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-48" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (props.mode === "edit" && profileQuery.isError) {
    const isNotFoundError =
      profileQuery.error instanceof SandboxProfilesApiError && profileQuery.error.status === 404;

    return (
      <div className="gap-4 flex flex-col">
        <h1 className="text-xl font-semibold">{pageTitle}</h1>
        <Card>
          <CardContent className="gap-3 flex flex-col pt-4">
            <Alert variant="destructive">
              <AlertTitle>
                {isNotFoundError ? "Sandbox profile not found" : "Could not load profile"}
              </AlertTitle>
              <AlertDescription>
                {resolveApiErrorMessage({
                  error: profileQuery.error,
                  fallbackMessage: isNotFoundError
                    ? "The sandbox profile was not found."
                    : "Could not load sandbox profile.",
                })}
              </AlertDescription>
            </Alert>
            <div>
              <Button
                onClick={() => {
                  void navigate("/sandbox-profiles");
                }}
                type="button"
                variant="outline"
              >
                Back to profiles
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="gap-4 flex flex-col">
      <h1 className="text-xl font-semibold">{pageTitle}</h1>
      <Card>
        <CardContent className="gap-4 flex flex-col pt-4">
          {saveError ? (
            <Alert variant="destructive">
              <AlertTitle>{props.mode === "create" ? "Create failed" : "Update failed"}</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel htmlFor="sandbox-profile-display-name">
              <span className="inline-flex items-center gap-0.5">
                Profile Name
                <span aria-hidden="true" className="text-destructive">
                  *
                </span>
              </span>
            </FieldLabel>
            <FieldContent>
              <Input
                className="w-full max-w-2xl"
                id="sandbox-profile-display-name"
                onChange={(event) => {
                  handleDisplayNameChange(event.currentTarget.value);
                }}
                value={formState.displayName}
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="sandbox-profile-status">Status</FieldLabel>
            <FieldContent>
              <Select onValueChange={handleStatusChange} value={formState.status}>
                <SelectTrigger aria-label="Sandbox profile status" id="sandbox-profile-status">
                  <SelectValue placeholder="Select status">
                    {formatSandboxProfileStatus(formState.status)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SANDBOX_PROFILE_STATUS_OPTIONS.map((statusOption) => (
                    <SelectItem key={statusOption} value={statusOption}>
                      {formatSandboxProfileStatus(statusOption)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldContent>
          </Field>

          {props.mode === "create" ? (
            <div className="gap-2 flex">
              <Button
                disabled={isDisplayNameInvalid || createMutation.isPending}
                onClick={handleCreate}
                type="button"
              >
                {createMutation.isPending ? "Creating..." : "Create profile"}
              </Button>
              <Button onClick={handleCancel} type="button" variant="outline">
                Cancel
              </Button>
            </div>
          ) : (
            <SaveActions
              cancelDisabled={!hasEditChanges || updateMutation.isPending}
              onCancel={handleCancel}
              onSave={handleSave}
              saveDisabled={!hasEditChanges || isDisplayNameInvalid || updateMutation.isPending}
              saveSuccess={saveSuccess}
              saving={updateMutation.isPending}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
