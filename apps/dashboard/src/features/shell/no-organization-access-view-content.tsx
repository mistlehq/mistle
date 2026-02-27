import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
  Input,
} from "@mistle/ui";

type NoOrganizationAccessViewContentProps = {
  email: string;
  organizationName: string;
  organizationNameError: string | null;
  createOrganizationError: string | null;
  isCreatingOrganization: boolean;
  isSigningOut: boolean;
  onOrganizationNameChange: (value: string) => void;
  onCreateOrganization: (event: React.SyntheticEvent<HTMLFormElement>) => void;
  onSignOut: () => void;
};

export function NoOrganizationAccessViewContent(
  props: NoOrganizationAccessViewContentProps,
): React.JSX.Element {
  return (
    <>
      <div className="rounded-md border px-4 py-3">
        <p className="text-sm">{`Your account ${props.email} isn't in any organizations yet.`}</p>
      </div>

      {props.createOrganizationError === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>Could not create organization</AlertTitle>
          <AlertDescription>{props.createOrganizationError}</AlertDescription>
        </Alert>
      )}

      <form className="gap-4 grid" onSubmit={props.onCreateOrganization}>
        <Field>
          <FieldLabel htmlFor="onboarding-organization-name">Organization name</FieldLabel>
          <FieldContent>
            <Input
              id="onboarding-organization-name"
              onChange={(event) => props.onOrganizationNameChange(event.currentTarget.value)}
              value={props.organizationName}
            />
          </FieldContent>
          {props.organizationNameError === null ? null : (
            <FieldError errors={[{ message: props.organizationNameError }]} />
          )}
        </Field>

        <Button className="w-full" disabled={props.isCreatingOrganization} type="submit">
          {props.isCreatingOrganization ? "Creating organization..." : "Create organization"}
        </Button>
      </form>

      <Button
        className="w-full"
        disabled={props.isSigningOut || props.isCreatingOrganization}
        onClick={props.onSignOut}
        type="button"
        variant="outline"
      >
        {props.isSigningOut ? "Signing out..." : "Sign Out"}
      </Button>
    </>
  );
}
