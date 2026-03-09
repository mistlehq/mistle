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

import { SaveActions } from "../settings/save-actions.js";

export type OrganizationGeneralSettingsPageViewProps = {
  hasDirtyChanges: boolean;
  isLoading: boolean;
  isSaving: boolean;
  loadErrorMessage: string | null;
  name: string;
  nameErrorMessage: string | null;
  onCancelChanges: () => void;
  onNameChange: (nextValue: string) => void;
  onRetryLoad: () => void;
  onSaveChanges: () => void;
  saveErrorMessage: string | null;
  saveSuccess: boolean;
};

export function OrganizationGeneralSettingsPageView(
  props: OrganizationGeneralSettingsPageViewProps,
): React.JSX.Element {
  if (props.isLoading) {
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

  if (props.loadErrorMessage) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Alert variant="destructive">
            <AlertTitle>Could not load organization settings</AlertTitle>
            <AlertDescription>{props.loadErrorMessage}</AlertDescription>
          </Alert>
          <div>
            <Button onClick={props.onRetryLoad} type="button" variant="outline">
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <p aria-live="polite" className="sr-only" role="status">
          {props.saveSuccess ? "Organization settings updated." : ""}
        </p>

        {props.saveErrorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>Update failed</AlertTitle>
            <AlertDescription>{props.saveErrorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <Field>
          <FieldLabel htmlFor="organization-name">Organization name</FieldLabel>
          <FieldContent>
            <Input
              id="organization-name"
              onChange={(event) => props.onNameChange(event.currentTarget.value)}
              value={props.name}
            />
          </FieldContent>
          {props.nameErrorMessage ? (
            <FieldError errors={[{ message: props.nameErrorMessage }]} />
          ) : null}
        </Field>

        <SaveActions
          cancelDisabled={!props.hasDirtyChanges || props.isSaving}
          onCancel={props.onCancelChanges}
          onSave={props.onSaveChanges}
          saveDisabled={!props.hasDirtyChanges || props.nameErrorMessage !== null || props.isSaving}
          saveSuccess={props.saveSuccess}
          saving={props.isSaving}
        />
      </CardContent>
    </Card>
  );
}
