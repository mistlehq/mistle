import { systemScheduler } from "@mistle/time";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
} from "@mistle/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { MembersApiError } from "../settings/members/members-api-errors.js";
import {
  getOrganizationGeneral,
  updateOrganizationGeneral,
} from "../settings/organization/organization-general-service.js";
import { SaveActions } from "../settings/save-actions.js";
import { organizationSummaryQueryKey } from "../shell/organization-summary.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";

const SETTINGS_ORGANIZATION_GENERAL_QUERY_KEY_PREFIX: readonly [
  "settings",
  "organization-general",
] = ["settings", "organization-general"];

type OrganizationFormState = {
  name: string;
};

function settingsOrganizationGeneralQueryKey(
  organizationId: string,
): readonly ["settings", "organization-general", string] {
  return [
    SETTINGS_ORGANIZATION_GENERAL_QUERY_KEY_PREFIX[0],
    SETTINGS_ORGANIZATION_GENERAL_QUERY_KEY_PREFIX[1],
    organizationId,
  ];
}

function toErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof MembersApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallbackMessage;
}

export function OrganizationGeneralSettingsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const organizationId = useRequiredOrganizationId();

  const [formState, setFormState] = useState<OrganizationFormState>({
    name: "",
  });
  const [persistedFormState, setPersistedFormState] = useState<OrganizationFormState>({
    name: "",
  });
  const [persistedSlug, setPersistedSlug] = useState("");
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const organizationQuery = useQuery({
    queryKey: settingsOrganizationGeneralQueryKey(organizationId),
    queryFn: async () =>
      getOrganizationGeneral({
        organizationId,
      }),
  });

  useEffect(() => {
    if (!organizationQuery.data) {
      return;
    }

    const loadedState = {
      name: organizationQuery.data.name,
    };
    setFormState(loadedState);
    setPersistedFormState(loadedState);
    setPersistedSlug(organizationQuery.data.slug);
  }, [organizationQuery.data]);

  useEffect(() => {
    if (!showSaveSuccess) {
      return;
    }

    const timeoutHandle = systemScheduler.schedule(() => {
      setShowSaveSuccess(false);
    }, 2000);

    return () => {
      systemScheduler.cancel(timeoutHandle);
    };
  }, [showSaveSuccess]);

  const saveMutation = useMutation({
    mutationFn: async (nextState: OrganizationFormState) =>
      updateOrganizationGeneral({
        organizationId,
        name: nextState.name,
        slug: persistedSlug,
      }),
    onSuccess: async (_result, variables) => {
      queryClient.setQueryData(organizationSummaryQueryKey(organizationId), {
        name: variables.name,
        slug: persistedSlug,
      });

      const refetched = await organizationQuery.refetch();
      const latest = refetched.data;
      if (latest) {
        const latestState = {
          name: latest.name,
        };
        setFormState(latestState);
        setPersistedFormState(latestState);
        setPersistedSlug(latest.slug);
        queryClient.setQueryData(organizationSummaryQueryKey(organizationId), {
          name: latest.name,
          slug: latest.slug,
        });
      }

      await queryClient.invalidateQueries({
        queryKey: organizationSummaryQueryKey(organizationId),
      });

      setShowSaveSuccess(true);
      setSaveError(null);
    },
    onError: (error: unknown) => {
      setSaveError(toErrorMessage(error, "Could not update organization settings."));
      setShowSaveSuccess(false);
    },
  });

  if (organizationQuery.isPending) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-3 w-64" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-20" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (organizationQuery.isError) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Alert variant="destructive">
            <AlertTitle>Could not load organization settings</AlertTitle>
            <AlertDescription>
              {toErrorMessage(organizationQuery.error, "Could not load organization settings.")}
            </AlertDescription>
          </Alert>
          <div>
            <Button
              onClick={() => void organizationQuery.refetch()}
              type="button"
              variant="outline"
            >
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const normalizedName = formState.name.trim();
  const hasDirtyChanges = normalizedName !== persistedFormState.name.trim();
  const hasNameError = normalizedName.length === 0;

  function handleNameChange(nextValue: string): void {
    setFormState((currentState) => ({
      ...currentState,
      name: nextValue,
    }));
    setSaveError(null);
    setShowSaveSuccess(false);
  }

  function handleCancelChanges(): void {
    setFormState(persistedFormState);
    setSaveError(null);
    setShowSaveSuccess(false);
  }

  function canSubmit(): boolean {
    return !(!hasDirtyChanges || hasNameError || saveMutation.isPending);
  }

  async function saveChanges(): Promise<void> {
    await saveMutation.mutateAsync({
      name: normalizedName,
    });
  }

  function handleSaveChanges(): void {
    void saveChanges();
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <p aria-live="polite" className="sr-only" role="status">
          {showSaveSuccess ? "Organization settings updated." : ""}
        </p>

        {saveError ? (
          <Alert variant="destructive">
            <AlertTitle>Update failed</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        ) : null}

        <Field>
          <FieldLabel htmlFor="organization-name">Organization name</FieldLabel>
          <FieldContent>
            <Input
              id="organization-name"
              onChange={(event) => handleNameChange(event.currentTarget.value)}
              value={formState.name}
            />
          </FieldContent>
          {hasNameError ? (
            <FieldError errors={[{ message: "Organization name is required." }]} />
          ) : null}
        </Field>

        <SaveActions
          cancelDisabled={!hasDirtyChanges || saveMutation.isPending}
          onCancel={handleCancelChanges}
          onSave={handleSaveChanges}
          saveDisabled={!canSubmit()}
          saveSuccess={showSaveSuccess}
          saving={saveMutation.isPending}
        />
      </CardContent>
    </Card>
  );
}
