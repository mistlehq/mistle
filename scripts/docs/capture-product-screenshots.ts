import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";

type ProductScreenshot = {
  storyId: string;
  output: string;
  viewport: {
    width: number;
    height: number;
  };
  selector?: string;
};

const OutputDirectory = "packages/docs/images/product-screens";
const StorybookBaseUrl = process.env["STORYBOOK_BASE_URL"] ?? "http://127.0.0.1:6006";

const Screenshots = [
  screen("identity-linking-organization-settings", "IdentityLinkingOrganizationSettings", {
    selector: '[data-docs-screenshot="identity-linking-organization-settings"]',
  }),
  screen("identity-linking-profile-settings", "IdentityLinkingProfileSettings", {
    height: 520,
    selector: '[data-docs-screenshot="identity-linking-profile-settings"]',
  }),
  screen("github-create-from-manifest", "GitHubCreateFromManifest"),
  screen("github-installed-connection", "GitHubInstalledConnection"),
  screen("slack-create-from-manifest", "SlackCreateFromManifest"),
  screen("slack-installed-connection", "SlackInstalledConnection"),
  screen("sandbox-profile-draft", "SandboxProfileDraft", {
    height: 1000,
  }),
  screen("sandbox-profile-setup-script", "SandboxProfileSetupScript", {
    height: 960,
  }),
  screen("sandbox-profile-setup-assistant", "SandboxProfileSetupAssistant", {
    height: 900,
  }),
  screen("sandbox-profile-snapshot-ready", "SandboxProfileSnapshotReady", {
    height: 820,
  }),
  screen("sandbox-profile-triggers", "SandboxProfileTriggers", {
    height: 860,
    width: 1400,
  }),
  screen("new-session-creation", "NewSessionCreation"),
  sessionScreen("session-workbench-overview", "SessionWorkbenchOverview", {
    height: 760,
    width: 1280,
  }),
  sessionScreen("session-code-diffs", "SessionCodeDiff", {
    height: 760,
    width: 1280,
  }),
  sessionScreen("session-port-access", "SessionPortAccess", {
    height: 320,
    width: 1280,
  }),
  screen("event-trigger", "EventTrigger"),
  screen("scheduled-trigger", "ScheduledTrigger"),
] satisfies readonly ProductScreenshot[];

function screen(
  output: string,
  storyName: string,
  options?: Partial<ProductScreenshot["viewport"]> & Pick<Partial<ProductScreenshot>, "selector">,
): ProductScreenshot {
  return {
    storyId: `product-screens-docs--${toStoryId(storyName)}`,
    output,
    ...(options?.selector === undefined ? {} : { selector: options.selector }),
    viewport: {
      width: options?.width ?? 1280,
      height: options?.height ?? 900,
    },
  };
}

function sessionScreen(
  output: string,
  storyName: string,
  viewport: ProductScreenshot["viewport"],
): ProductScreenshot {
  return {
    ...screen(output, storyName, viewport),
    selector: `[data-docs-screenshot="${output}"]`,
  };
}

function toStoryId(storyName: string): string {
  return storyName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

async function captureScreenshot(page: Page, screenshot: ProductScreenshot): Promise<void> {
  await page.setViewportSize(screenshot.viewport);
  await page.goto(`${StorybookBaseUrl}/iframe.html?id=${screenshot.storyId}`, {
    waitUntil: "networkidle",
  });

  const locator =
    screenshot.selector === undefined
      ? page.locator("#storybook-root")
      : page.locator(screenshot.selector);
  await locator.waitFor({ state: "visible" });
  await locator.screenshot({
    path: path.join(OutputDirectory, `${screenshot.output}.png`),
  });
}

async function main(): Promise<void> {
  await mkdir(OutputDirectory, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
    });
    for (const screenshot of Screenshots) {
      await captureScreenshot(page, screenshot);
      process.stdout.write(`captured ${screenshot.output}\n`);
    }
  } finally {
    await browser.close();
  }
}

await main();
