import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldHeader,
  FieldLabel,
  Input,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
} from "@mistle/ui";

import type {
  OrganizationSandboxStorageFormErrors,
  OrganizationSandboxStorageFormState,
} from "../settings/organization/sandbox-storage-model.js";
import { SaveActions } from "../settings/save-actions.js";
import { FormPageSection, FormPageStack } from "../shared/form-page.js";

export type OrganizationSandboxStorageSettingsPageViewProps = {
  state: OrganizationSandboxStorageFormState;
  isLoading: boolean;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  saveErrorMessage: string | null;
  loadErrorMessage: string | null;
  visibleErrors: OrganizationSandboxStorageFormErrors;
  onCancel: () => void;
  onSave: () => Promise<void>;
  onStateChange: (state: OrganizationSandboxStorageFormState) => void;
};

export function OrganizationSandboxStorageSettingsPageView(
  input: OrganizationSandboxStorageSettingsPageViewProps,
): React.JSX.Element {
  if (input.isLoading) {
    return (
      <FormPageStack>
        <FormPageSection>
          <div className="flex flex-col gap-4 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </FormPageSection>
      </FormPageStack>
    );
  }

  if (input.loadErrorMessage !== null) {
    return (
      <FormPageStack>
        <FormPageSection>
          <div className="p-4">
            <Notice variant="alert">{input.loadErrorMessage} Please try again later.</Notice>
          </div>
        </FormPageSection>
      </FormPageStack>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void input.onSave();
      }}
    >
      <FormPageStack>
        <FormPageSection>
          <div className="flex flex-col gap-4 p-4">
            {input.saveErrorMessage === null ? null : (
              <Notice variant="alert">{input.saveErrorMessage}</Notice>
            )}
            <Field orientation="horizontal">
              <FieldHeader>
                <FieldLabel htmlFor="persistent-sandboxes-enabled">
                  Persistent sandboxes enabled
                </FieldLabel>
                <FieldDescription>
                  Allow this organization to use persistent sandbox storage.
                </FieldDescription>
              </FieldHeader>
              <FieldContent>
                <Switch
                  checked={input.state.persistentSandboxesEnabled}
                  id="persistent-sandboxes-enabled"
                  onCheckedChange={(checked) => {
                    input.onStateChange({
                      ...input.state,
                      persistentSandboxesEnabled: checked,
                    });
                  }}
                />
              </FieldContent>
            </Field>

            <Field orientation="horizontal">
              <FieldHeader>
                <FieldLabel>Configuration source</FieldLabel>
                <FieldDescription>
                  Managed uses the deployment default. Organization override stores Archil
                  credentials for this organization.
                </FieldDescription>
              </FieldHeader>
              <FieldContent>
                <Select
                  onValueChange={(value) => {
                    if (value === null) {
                      return;
                    }

                    input.onStateChange({
                      ...input.state,
                      storageConfigSource: value,
                    });
                  }}
                  value={input.state.storageConfigSource}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="managed">Managed</SelectItem>
                    <SelectItem value="organization">Organization override</SelectItem>
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>

            {input.state.storageConfigSource === "managed" ? (
              <Notice>
                Deployment-managed sandbox storage settings will be used for this organization.
              </Notice>
            ) : (
              <>
                {(input.state.apiKeyConfigured || input.state.secretAccessKeyConfigured) && (
                  <Notice>
                    Existing secrets are not returned to the dashboard. Re-enter the configured
                    secret fields below to keep or update this organization override.
                  </Notice>
                )}

                <Field orientation="horizontal">
                  <FieldHeader>
                    <FieldLabel htmlFor="sandbox-storage-region">Region</FieldLabel>
                  </FieldHeader>
                  <FieldContent>
                    <Input
                      id="sandbox-storage-region"
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        input.onStateChange({
                          ...input.state,
                          region: event.currentTarget.value,
                        });
                      }}
                      value={input.state.region}
                    />
                    {input.visibleErrors.region === undefined ? null : (
                      <FieldError errors={[{ message: input.visibleErrors.region }]} />
                    )}
                  </FieldContent>
                </Field>

                <Field orientation="horizontal">
                  <FieldHeader>
                    <FieldLabel htmlFor="sandbox-storage-name-prefix">Name prefix</FieldLabel>
                    <FieldDescription>
                      Optional prefix prepended to created disk names.
                    </FieldDescription>
                  </FieldHeader>
                  <FieldContent>
                    <Input
                      id="sandbox-storage-name-prefix"
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        input.onStateChange({
                          ...input.state,
                          namePrefix: event.currentTarget.value,
                        });
                      }}
                      value={input.state.namePrefix}
                    />
                  </FieldContent>
                </Field>

                <Field orientation="horizontal">
                  <FieldHeader>
                    <FieldLabel htmlFor="sandbox-storage-api-key">API key</FieldLabel>
                    <FieldDescription>
                      {input.state.apiKeyConfigured
                        ? "API key configured. Re-enter it to keep or update this override."
                        : "Archil API key for provisioning persistent sandbox disks."}
                    </FieldDescription>
                  </FieldHeader>
                  <FieldContent>
                    <Input
                      id="sandbox-storage-api-key"
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        input.onStateChange({
                          ...input.state,
                          apiKey: event.currentTarget.value,
                        });
                      }}
                      type="password"
                      value={input.state.apiKey}
                    />
                    {input.visibleErrors.apiKey === undefined ? null : (
                      <FieldError errors={[{ message: input.visibleErrors.apiKey }]} />
                    )}
                  </FieldContent>
                </Field>

                <Field orientation="horizontal">
                  <FieldHeader>
                    <FieldLabel htmlFor="sandbox-storage-bucket">Bucket</FieldLabel>
                  </FieldHeader>
                  <FieldContent>
                    <Input
                      id="sandbox-storage-bucket"
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        input.onStateChange({
                          ...input.state,
                          bucket: event.currentTarget.value,
                        });
                      }}
                      value={input.state.bucket}
                    />
                    {input.visibleErrors.bucket === undefined ? null : (
                      <FieldError errors={[{ message: input.visibleErrors.bucket }]} />
                    )}
                  </FieldContent>
                </Field>

                <Field orientation="horizontal">
                  <FieldHeader>
                    <FieldLabel htmlFor="sandbox-storage-endpoint">Endpoint</FieldLabel>
                  </FieldHeader>
                  <FieldContent>
                    <Input
                      id="sandbox-storage-endpoint"
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        input.onStateChange({
                          ...input.state,
                          endpoint: event.currentTarget.value,
                        });
                      }}
                      value={input.state.endpoint}
                    />
                    {input.visibleErrors.endpoint === undefined ? null : (
                      <FieldError errors={[{ message: input.visibleErrors.endpoint }]} />
                    )}
                  </FieldContent>
                </Field>

                <Field orientation="horizontal">
                  <FieldHeader>
                    <FieldLabel htmlFor="sandbox-storage-access-key-id">Access key ID</FieldLabel>
                  </FieldHeader>
                  <FieldContent>
                    <Input
                      id="sandbox-storage-access-key-id"
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        input.onStateChange({
                          ...input.state,
                          accessKeyId: event.currentTarget.value,
                        });
                      }}
                      value={input.state.accessKeyId}
                    />
                    {input.visibleErrors.accessKeyId === undefined ? null : (
                      <FieldError errors={[{ message: input.visibleErrors.accessKeyId }]} />
                    )}
                  </FieldContent>
                </Field>

                <Field orientation="horizontal">
                  <FieldHeader>
                    <FieldLabel htmlFor="sandbox-storage-secret-access-key">
                      Secret access key
                    </FieldLabel>
                    <FieldDescription>
                      {input.state.secretAccessKeyConfigured
                        ? "Secret access key configured. Re-enter it to keep or update this override."
                        : "Secret access key used by the configured S3-compatible mount."}
                    </FieldDescription>
                  </FieldHeader>
                  <FieldContent>
                    <Input
                      id="sandbox-storage-secret-access-key"
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        input.onStateChange({
                          ...input.state,
                          secretAccessKey: event.currentTarget.value,
                        });
                      }}
                      type="password"
                      value={input.state.secretAccessKey}
                    />
                    {input.visibleErrors.secretAccessKey === undefined ? null : (
                      <FieldError errors={[{ message: input.visibleErrors.secretAccessKey }]} />
                    )}
                  </FieldContent>
                </Field>
              </>
            )}
          </div>
        </FormPageSection>
        <SaveActions
          cancelDisabled={!input.hasUnsavedChanges || input.isSaving}
          onCancel={input.onCancel}
          onSave={() => {
            void input.onSave();
          }}
          saveDisabled={!input.hasUnsavedChanges || input.isSaving}
          saveSuccess={false}
          saving={input.isSaving}
        />
      </FormPageStack>
    </form>
  );
}
