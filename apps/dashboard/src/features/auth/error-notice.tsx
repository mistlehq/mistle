import { Notice } from "@mistle/ui";

type ErrorNoticeProps = {
  message: string | null;
};

export function ErrorNotice(props: ErrorNoticeProps): React.JSX.Element | null {
  if (!props.message) {
    return null;
  }

  return (
    <Notice
      aria-atomic="true"
      aria-live="assertive"
      role="alert"
      title="Something went wrong"
      tone="destructive"
    >
      {props.message}
    </Notice>
  );
}
