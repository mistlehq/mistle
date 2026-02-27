import type React from "react";

import { EmailStepForm } from "./email-step-form.js";
import { ErrorNotice } from "./error-notice.js";

type EmailStageProps = {
  authError: string | null;
  beforeForm?: React.ReactNode;
  email: string;
  footerError: string | null;
  isEmailEditable?: boolean;
  isEmailHidden?: boolean;
  isSendingOtp: boolean;
  onEmailChange: (value: string) => void;
  onSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => Promise<void>;
  submitLabel?: string;
};

export function EmailStage(props: EmailStageProps): React.JSX.Element {
  return (
    <div className="gap-4 pt-1 flex flex-col">
      {props.beforeForm === undefined ? null : props.beforeForm}
      <ErrorNotice message={props.authError} />
      <EmailStepForm
        email={props.email}
        isSendingOtp={props.isSendingOtp}
        onEmailChange={props.onEmailChange}
        onSubmit={props.onSubmit}
        {...(props.isEmailEditable === undefined ? {} : { isEmailEditable: props.isEmailEditable })}
        {...(props.isEmailHidden === undefined ? {} : { isEmailHidden: props.isEmailHidden })}
        {...(props.submitLabel === undefined ? {} : { submitLabel: props.submitLabel })}
      />
      <ErrorNotice message={props.footerError} />
    </div>
  );
}
