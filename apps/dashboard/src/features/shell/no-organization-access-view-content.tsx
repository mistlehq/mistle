import { Button, Field, FieldContent, Input, Notice } from "@mistle/ui";

type NoOrganizationAccessViewContentProps = {
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
      {props.organizationNameError === null ? null : (
        <Notice variant="alert">{props.organizationNameError}</Notice>
      )}

      {props.createOrganizationError === null ? null : (
        <Notice variant="alert">{props.createOrganizationError}</Notice>
      )}

      <form className="flex flex-col gap-4" onSubmit={props.onCreateOrganization}>
        <Field>
          <FieldContent>
            <Input
              aria-label="Organization name"
              aria-invalid={props.organizationNameError === null ? undefined : true}
              autoFocus
              className="h-12"
              id="onboarding-organization-name"
              onChange={(event) => props.onOrganizationNameChange(event.currentTarget.value)}
              placeholder="Organization name"
              value={props.organizationName}
            />
          </FieldContent>
        </Field>

        <Button
          className="h-12 w-full text-sm"
          disabled={props.isCreatingOrganization}
          size="lg"
          type="submit"
        >
          {props.isCreatingOrganization ? "Creating organization..." : "Create organization"}
        </Button>

        <Button
          className="h-12 w-full text-sm"
          disabled={props.isSigningOut || props.isCreatingOrganization}
          onClick={props.onSignOut}
          size="lg"
          type="button"
          variant="outline"
        >
          {props.isSigningOut ? "Signing out..." : "Sign Out"}
        </Button>
      </form>

      <div className="mt-6 grid gap-3">
        <div className="text-muted-foreground flex items-center gap-4">
          <div className="bg-border h-px flex-1" />
          <p className="text-xs font-medium tracking-[0.2em] uppercase">Have an existing org?</p>
          <div className="bg-border h-px flex-1" />
        </div>
        <div className="grid gap-2 text-center">
          <p className="text-muted-foreground text-sm">Ask your administrator for an invite.</p>
        </div>
      </div>
    </>
  );
}
