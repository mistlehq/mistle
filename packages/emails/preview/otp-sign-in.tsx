import { PreviewMetadataLayout } from "../preview-support/preview-metadata.js";
import { EmailOTPTemplate, type EmailOTPTemplateProps } from "../src/templates/otp/template.js";

export const templateName = "OTP Sign In";
const subject = "Your sign-in code";
const preview = "Use this code to sign in to Mistle. Expires in 5 minutes.";

export const previewProps: EmailOTPTemplateProps = {
  bodyMessage: "Use this code to sign in to Mistle",
  otp: "123456",
  expiresInSeconds: 300,
  preview,
  title: subject,
};

export function Template(props: EmailOTPTemplateProps) {
  return (
    <PreviewMetadataLayout preview={preview} subject={subject} templateName={templateName}>
      <EmailOTPTemplate {...props} />
    </PreviewMetadataLayout>
  );
}
