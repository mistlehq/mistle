import { it as vitestIt } from "vitest";

import { startMailpit, type MailpitService } from "../src/index.js";

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
