import { Notice, Skeleton } from "@mistle/ui";

import { AutoSaveTextField } from "../forms/auto-save-text-field.js";
import { FormPageSection, FormPageStack } from "../shared/form-page.js";
import { SettingsImageField } from "../shared/settings-image-field.js";

export type OrganizationGeneralSettingsPageViewProps = {
  isLoading: boolean;
  isSaving: boolean;
  loadErrorMessage: string | null;
  logoBusy: boolean;
  logoErrorMessage: string | null;
  logoUrl: string | null;
  name: string;
  onDeleteLogo: () => Promise<void>;
  onSaveChanges: (name: string) => Promise<void>;
  onUploadLogo: (file: File) => Promise<void>;
};

export function OrganizationGeneralSettingsPageView(
  props: OrganizationGeneralSettingsPageViewProps,
): React.JSX.Element {
  if (props.isLoading) {
    return (
      <FormPageStack>
        <FormPageSection>
          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-3 w-64" />
            </div>
          </div>
        </FormPageSection>
      </FormPageStack>
    );
  }

  if (props.loadErrorMessage) {
    return (
      <FormPageStack>
        <FormPageSection>
          <div className="flex flex-col gap-3 p-4">
            <Notice variant="alert">{props.loadErrorMessage} Please try again later.</Notice>
          </div>
        </FormPageSection>
      </FormPageStack>
    );
  }

  return (
    <FormPageStack>
      <FormPageSection>
        <div className="flex flex-col gap-4 p-4">
          <SettingsImageField
            alt={`${props.name} logo`}
            busy={props.logoBusy}
            errorMessage={props.logoErrorMessage}
            fallbackInitial="O"
            imageUrl={props.logoUrl}
            imageName="organization logo"
            label="Logo"
            name={props.name}
            onDelete={props.onDeleteLogo}
            onUpload={props.onUploadLogo}
          />
          <AutoSaveTextField
            disabled={props.isSaving}
            id="organization-name"
            label="Organization name"
            onSave={props.onSaveChanges}
            validate={(nextValue) => {
              return nextValue.trim().length === 0 ? "Organization name is required." : null;
            }}
            value={props.name}
          />
        </div>
      </FormPageSection>
    </FormPageStack>
  );
}
