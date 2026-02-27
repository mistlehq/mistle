import { Button } from "@mistle/ui";

type NoOrganizationAccessViewContentProps = {
  email: string;
  isSigningOut: boolean;
  onSignOut: () => void;
};

export function NoOrganizationAccessViewContent(
  props: NoOrganizationAccessViewContentProps,
): React.JSX.Element {
  return (
    <>
      <div className="rounded-md border px-4 py-3">
        <p className="text-sm">{`Your account ${props.email} isn't in any organizations.`}</p>
      </div>
      <Button
        className="w-full"
        disabled={props.isSigningOut}
        onClick={props.onSignOut}
        type="button"
      >
        {props.isSigningOut ? "Signing out..." : "Sign Out"}
      </Button>
    </>
  );
}
