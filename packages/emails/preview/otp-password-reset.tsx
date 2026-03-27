import { PreviewMetadataLayout } from "../preview-support/preview-metadata.js";
import { EmailOTPTemplate, type EmailOTPTemplateProps } from "../src/templates/otp/template.js";

export const templateName = "OTP Password Reset";
const subject = "Your password reset code";
const preview = "Use this code to reset your password on Mistle. Expires in 5 minutes.";

export const previewProps: EmailOTPTemplateProps = {
  bodyMessage: "Use this code to reset your password on Mistle",
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
