import { startMailpit, type MailpitService } from "@mistle/test-harness";
import { it as vitestIt } from "vitest";

export const it = vitestIt.extend<{ mailpitService: MailpitService }>({
  mailpitService: [
    async ({}, use) => {
      const mailpitService = await startMailpit();
      await use(mailpitService);
      await mailpitService.stop();
    },
    {
      scope: "file",
    },
  ],
});
