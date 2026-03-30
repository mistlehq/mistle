import { PreviewMetadataLayout } from "../preview-support/preview-metadata.js";
import { EmailOTPTemplate, type EmailOTPTemplateProps } from "../src/templates/otp/template.js";

export const templateName = "OTP Email Verification";
const subject = "Verify your email";
const preview = "Confirm your email address for Mistle with this code. Expires in 5 minutes.";

export const previewProps: EmailOTPTemplateProps = {
  bodyMessage: "Use this code to verify your email for Mistle",
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
