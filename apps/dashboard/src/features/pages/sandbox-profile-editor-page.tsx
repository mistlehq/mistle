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
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
} from "@mistle/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { formatConnectionDisplayName } from "../integrations/format-connection-display-name.js";
import { formatSandboxProfileVersionLabel } from "../sandbox-profiles/format-sandbox-profile-version-label.js";
import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import {
  sandboxProfileDetailQueryKey,
  sandboxProfileVersionIntegrationBindingsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { getSandboxProfile } from "../sandbox-profiles/sandbox-profiles-service.js";
import type {
  SandboxIntegrationBindingKind,
  SandboxProfileVersion,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  createDefaultBindingConfig,
  resolveBindingKindFromTarget,
  SandboxProfileBindingConfigEditor,
  type IntegrationConnectionSummary,
  type IntegrationTargetSummary,
  type SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import { useSandboxProfileIntegrationsState } from "./sandbox-profile-integrations-state.js";
import {
  resolveStatusToggleChecked,
  useSandboxProfileMetaState,
} from "./sandbox-profile-meta-state.js";
import { SandboxProfileTitleEditor } from "./sandbox-profile-title-editor.js";

type SandboxProfileEditorPageProps = {
  mode: "create" | "edit";
};

function formatBindingKind(kind: SandboxIntegrationBindingKind): string {
  if (kind === "agent") {
    return "Agent";
  }
  if (kind === "git") {
    return "Git";
  }
  return "Connector";
}

type IntegrationsEditorSectionProps = {
  profileVersionsQuery: {
    isError: boolean;
    error: unknown;
    isPending: boolean;
    data: { versions: SandboxProfileVersion[] } | undefined;
  };
  resolvedSelectedVersion: number | null;
  onSelectedVersionChange: (nextValue: string | null) => void;
  selectedVersionDisplayName: string | undefined;
  integrationBindingsQuery: {
    isError: boolean;
    error: unknown;
    isPending: boolean;
  };
  integrationDirectoryQuery: {
    isError: boolean;
    error: unknown;
    isPending: boolean;
  };
  integrationSaveError: string | null;
  integrationRows: readonly SandboxProfileBindingEditorRow[];
  integrationRowErrorsByClientId: Readonly<Record<string, string>>;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  onRemoveIntegrationBindingRow: (clientId: string) => void;
  onIntegrationBindingRowChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  resolveSelectedConnectionDisplayName: (row: SandboxProfileBindingEditorRow) => string | undefined;
  onAddIntegrationBindingRow: () => void;
  onSaveIntegrationBindings: () => void;
  isSavingIntegrationBindings: boolean;
  integrationSaveSuccess: boolean;
};

function IntegrationsEditorSection(props: IntegrationsEditorSectionProps): React.JSX.Element {
  return (
    <Card>
      <CardContent className="gap-4 flex flex-col pt-4">
        <div className="gap-1 flex flex-col">
          <h2 className="text-lg font-semibold">Integrations</h2>
          <p className="text-muted-foreground text-sm">
            Assign integration connections for a specific sandbox profile version.
          </p>
        </div>

        {props.profileVersionsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load sandbox profile versions</AlertTitle>
            <AlertDescription>
              {resolveApiErrorMessage({
                error: props.profileVersionsQuery.error,
                fallbackMessage: "Could not load sandbox profile versions.",
              })}
            </AlertDescription>
          </Alert>
        ) : null}

        <Field>
          <FieldLabel htmlFor="sandbox-profile-version">Profile version</FieldLabel>
          <FieldContent>
            <Select
              disabled={
                props.profileVersionsQuery.isPending ||
                props.profileVersionsQuery.data === undefined
              }
              onValueChange={props.onSelectedVersionChange}
              value={
                props.resolvedSelectedVersion === null
                  ? undefined
                  : String(props.resolvedSelectedVersion)
              }
            >
              <SelectTrigger aria-label="Sandbox profile version" id="sandbox-profile-version">
                <SelectValue placeholder="Select profile version">
                  {props.selectedVersionDisplayName}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(props.profileVersionsQuery.data?.versions ?? []).map((version) => (
                  <SelectItem key={version.version} value={String(version.version)}>
                    {formatSandboxProfileVersionLabel(version.version)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldContent>
        </Field>

        {props.resolvedSelectedVersion === null ? null : props.integrationBindingsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load integration bindings</AlertTitle>
            <AlertDescription>
              {resolveApiErrorMessage({
                error: props.integrationBindingsQuery.error,
                fallbackMessage: "Could not load sandbox profile integration bindings.",
              })}
            </AlertDescription>
          </Alert>
        ) : null}

        {props.integrationDirectoryQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load integration connections</AlertTitle>
            <AlertDescription>
              {resolveApiErrorMessage({
                error: props.integrationDirectoryQuery.error,
                fallbackMessage: "Could not load integration connections.",
              })}
            </AlertDescription>
          </Alert>
        ) : null}

        {props.integrationSaveError ? (
          <Alert variant="destructive">
            <AlertTitle>Save failed</AlertTitle>
            <AlertDescription>{props.integrationSaveError}</AlertDescription>
          </Alert>
        ) : null}

        {props.integrationRows.map((row, rowIndex) => (
          <div className="gap-3 rounded-md border p-3 flex flex-col" key={row.clientId}>
            <div className="flex items-center justify-between">
              <Label>Binding {rowIndex + 1}</Label>
              <Button
                onClick={() => {
                  props.onRemoveIntegrationBindingRow(row.clientId);
                }}
                type="button"
                variant="outline"
              >
                Remove
              </Button>
            </div>

            <Field>
              <FieldLabel>Kind</FieldLabel>
              <FieldContent>
                <p className="text-muted-foreground text-sm">{formatBindingKind(row.kind)}</p>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor={`binding-connection-${row.clientId}`}>Connection</FieldLabel>
              <FieldContent>
                <Select
                  onValueChange={(nextValue) => {
                    if (nextValue === null) {
                      throw new Error("Binding connection must not be null.");
                    }
                    const selectedConnection = props.availableConnections.find(
                      (connection) => connection.id === nextValue,
                    );
                    const selectedTarget =
                      selectedConnection === undefined
                        ? undefined
                        : props.availableTargets.find(
                            (target) => target.targetKey === selectedConnection.targetKey,
                          );
                    const resolvedKind = resolveBindingKindFromTarget(selectedTarget);
                    props.onIntegrationBindingRowChange(row.clientId, {
                      connectionId: nextValue,
                      ...(resolvedKind === undefined ? {} : { kind: resolvedKind }),
                      config: createDefaultBindingConfig({
                        ...(selectedConnection === undefined
                          ? {}
                          : { connection: selectedConnection }),
                        ...(selectedTarget === undefined ? {} : { target: selectedTarget }),
                      }),
                    });
                  }}
                  value={row.connectionId === "" ? undefined : row.connectionId}
                >
                  <SelectTrigger
                    aria-label="Binding connection"
                    id={`binding-connection-${row.clientId}`}
                  >
                    <SelectValue placeholder="Select integration connection">
                      {props.resolveSelectedConnectionDisplayName(row)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {props.availableConnections.map((connection) => (
                      <SelectItem key={connection.id} value={connection.id}>
                        {formatConnectionDisplayName({
                          connection,
                          targets: props.availableTargets,
                        })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>Config</FieldLabel>
              <FieldContent>
                <SandboxProfileBindingConfigEditor
                  availableConnections={props.availableConnections}
                  availableTargets={props.availableTargets}
                  onIntegrationBindingRowChange={props.onIntegrationBindingRowChange}
                  row={row}
                />
              </FieldContent>
            </Field>

            {props.integrationRowErrorsByClientId[row.clientId] !== undefined ? (
              <p className="text-destructive text-sm">
                {props.integrationRowErrorsByClientId[row.clientId]}
              </p>
            ) : null}
          </div>
        ))}

        <div className="gap-2 flex">
          <Button onClick={props.onAddIntegrationBindingRow} type="button" variant="outline">
            Add binding
          </Button>
          <Button
            disabled={
              props.resolvedSelectedVersion === null ||
              props.integrationBindingsQuery.isPending ||
              props.integrationDirectoryQuery.isPending ||
              props.isSavingIntegrationBindings
            }
            onClick={props.onSaveIntegrationBindings}
            type="button"
          >
            {props.isSavingIntegrationBindings ? "Saving..." : "Save integrations"}
          </Button>
          {props.integrationSaveSuccess ? (
            <p className="text-muted-foreground text-sm self-center">Saved.</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function SandboxProfileEditorPage(props: SandboxProfileEditorPageProps): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams();
  const profileId = params["profileId"];
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
  const metaState = useSandboxProfileMetaState({
    mode: props.mode,
    profileId,
    loadedProfile: profileQuery.data,
    navigate,
    invalidateSandboxProfiles: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["sandbox-profiles"],
      });
    },
    invalidateProfileDetail: async (invalidateProfileId) => {
      await queryClient.invalidateQueries({
        queryKey: sandboxProfileDetailQueryKey(invalidateProfileId),
      });
    },
  });

  const integrationsState = useSandboxProfileIntegrationsState({
    mode: props.mode,
    profileId,
    invalidateVersionBindings: async ({ profileId: invalidateProfileId, version }) => {
      await queryClient.invalidateQueries({
        queryKey: sandboxProfileVersionIntegrationBindingsQueryKey({
          profileId: invalidateProfileId,
          version,
        }),
      });
    },
  });

  if (props.mode === "edit" && profileQuery.isPending) {
    return (
      <div className="gap-4 flex flex-col">
        <h1 className="text-xl font-semibold">{metaState.pageTitle}</h1>
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
        <h1 className="text-xl font-semibold">{metaState.pageTitle}</h1>
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        {props.mode === "create" ? (
          <h1 className="text-xl font-semibold">{metaState.pageTitle}</h1>
        ) : (
          <SandboxProfileTitleEditor
            draftValue={metaState.profileNameDraft}
            isEditing={metaState.isEditingProfileName}
            onCancel={metaState.onProfileNameEditCancel}
            onCommit={metaState.onProfileNameEditCommit}
            onDraftValueChange={metaState.onProfileNameDraftChange}
            onEditStart={metaState.onProfileNameEditStart}
            saveDisabled={metaState.isUpdating}
            title={metaState.pageTitle}
          />
        )}

        <div className="inline-flex h-11 items-center gap-2 rounded-md border px-3">
          <Label
            className={
              metaState.formState.status === "inactive"
                ? "text-foreground"
                : "text-muted-foreground"
            }
            htmlFor="sandbox-profile-status-toggle"
          >
            Inactive
          </Label>
          <Switch
            aria-label="Sandbox profile status"
            checked={resolveStatusToggleChecked(metaState.formState.status)}
            disabled={metaState.isCreating || metaState.isUpdating}
            id="sandbox-profile-status-toggle"
            onCheckedChange={metaState.onStatusToggleChange}
          />
          <Label
            className={
              metaState.formState.status === "active" ? "text-foreground" : "text-muted-foreground"
            }
            htmlFor="sandbox-profile-status-toggle"
          >
            Active
          </Label>
        </div>
      </div>
      {metaState.saveError ? (
        <Alert variant="destructive">
          <AlertTitle>{props.mode === "create" ? "Create failed" : "Update failed"}</AlertTitle>
          <AlertDescription>{metaState.saveError}</AlertDescription>
        </Alert>
      ) : null}

      {props.mode === "create" ? (
        <Card>
          <CardContent className="gap-4 flex flex-col pt-4">
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
                    metaState.onDisplayNameChange(event.currentTarget.value);
                  }}
                  value={metaState.formState.displayName}
                />
              </FieldContent>
            </Field>

            <div className="gap-2 flex">
              <Button
                disabled={metaState.isDisplayNameInvalid || metaState.isCreating}
                onClick={metaState.onCreate}
                type="button"
              >
                {metaState.isCreating ? "Creating..." : "Create profile"}
              </Button>
              <Button onClick={metaState.onCancelCreate} type="button" variant="outline">
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {integrationsState.canEditIntegrations ? (
        <IntegrationsEditorSection
          availableConnections={integrationsState.availableConnections}
          availableTargets={integrationsState.availableTargets}
          integrationBindingsQuery={integrationsState.integrationBindingsQuery}
          integrationDirectoryQuery={integrationsState.integrationDirectoryQuery}
          integrationRowErrorsByClientId={integrationsState.integrationRowErrorsByClientId}
          integrationRows={integrationsState.integrationRows}
          integrationSaveError={integrationsState.integrationSaveError}
          integrationSaveSuccess={integrationsState.integrationSaveSuccess}
          isSavingIntegrationBindings={integrationsState.isSavingIntegrationBindings}
          onAddIntegrationBindingRow={integrationsState.onAddIntegrationBindingRow}
          onIntegrationBindingRowChange={integrationsState.onIntegrationBindingRowChange}
          onRemoveIntegrationBindingRow={integrationsState.onRemoveIntegrationBindingRow}
          onSaveIntegrationBindings={integrationsState.onSaveIntegrationBindings}
          onSelectedVersionChange={integrationsState.onSelectedVersionChange}
          profileVersionsQuery={integrationsState.profileVersionsQuery}
          resolveSelectedConnectionDisplayName={
            integrationsState.resolveSelectedConnectionDisplayName
          }
          resolvedSelectedVersion={integrationsState.resolvedSelectedVersion}
          selectedVersionDisplayName={integrationsState.selectedVersionDisplayName}
        />
      ) : null}
    </div>
  );
}
