import {
  EmailTemplateIds,
  sendEmail,
  type EmailSender,
  type EmailTemplateInputById,
} from "@mistle/emails";

type OTPVerificationType = EmailTemplateInputById[typeof EmailTemplateIds.OTP]["type"];

type SendVerificationOTPRequest = {
  email: string;
  otp: string;
  type: OTPVerificationType;
};

type CreateSendVerificationOTPServiceInput = {
  emailSender: EmailSender;
  from: {
    email: string;
    name: string;
  };
  expiresInSeconds: number;
};

export function createSendVerificationOTPService(input: CreateSendVerificationOTPServiceInput) {
  const { emailSender, from, expiresInSeconds } = input;

  return async (data: SendVerificationOTPRequest): Promise<void> => {
    await sendEmail({
      sender: emailSender,
      from,
      to: [
        {
          email: data.email,
        },
      ],
      templateId: EmailTemplateIds.OTP,
      templateInput: {
        otp: data.otp,
        type: data.type,
        expiresInSeconds,
      },
    });
  };
}
