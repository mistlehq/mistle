import { Alert, AlertDescription, AlertTitle } from "@mistle/ui";

type ErrorNoticeProps = {
  message: string | null;
};

export function ErrorNotice(props: ErrorNoticeProps): React.JSX.Element | null {
  if (!props.message) {
    return null;
  }

  return (
    <Alert aria-atomic="true" aria-live="assertive" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{props.message}</AlertDescription>
    </Alert>
  );
}
