import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  createAgentRuntimeRegistry,
  listIntegrationDefinitions,
} from "@mistle/integrations-definitions";
import { describe, expect, it } from "vitest";

import { resolveIntegrationLogoPath } from "./logo.js";

const DashboardIntegrationLogoDirectory = join(process.cwd(), "public/integration-logos");

function listProductionDefinitionLogoKeys(): readonly string[] {
  const logoKeys = new Set<string>();

  for (const definition of listIntegrationDefinitions()) {
    if (definition.logoKey !== undefined) {
      logoKeys.add(definition.logoKey);
    }
  }

  for (const definition of createAgentRuntimeRegistry().listRuntimes()) {
    logoKeys.add(definition.logoKey);
  }

  return [...logoKeys].sort();
}

function listDashboardLightAssetLogoKeys(): readonly string[] {
  return readdirSync(DashboardIntegrationLogoDirectory)
    .filter((fileName) => fileName.endsWith(".svg") && !fileName.endsWith("-dark.svg"))
    .map((fileName) => fileName.replace(/\.svg$/, ""))
    .sort();
}

function readSvgViewBoxDimensions(fileName: string): { height: number; width: number } {
  const contents = readFileSync(join(DashboardIntegrationLogoDirectory, fileName), "utf8");
  const viewBox = contents.match(/\bviewBox="([^"]+)"/)?.[1];
  if (viewBox === undefined) {
    throw new Error(`${fileName} should define a viewBox`);
  }

  const dimensions = viewBox.split(/\s+/).map(Number);
  if (dimensions.length !== 4) {
    throw new Error(`${fileName} viewBox should have four numeric parts`);
  }

  const width = Number(dimensions[2]);
  const height = Number(dimensions[3]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`${fileName} viewBox width and height should be numeric`);
  }

  return { height, width };
}

function readPngHeader(fileName: string): { colorType: number; height: number; width: number } {
  const contents = readFileSync(join(DashboardIntegrationLogoDirectory, fileName));
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  if (!contents.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error(`${fileName} should be a PNG file`);
  }

  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
    colorType: contents.readUInt8(25),
  };
}

describe("dashboard integration logo assets", () => {
  it("has a light dashboard asset for every integration definition logo key", () => {
    for (const logoKey of listProductionDefinitionLogoKeys()) {
      const logoPath = resolveIntegrationLogoPath({ logoKey });
      expect(existsSync(join(process.cwd(), "public", logoPath))).toBe(true);
    }
  });

  it("keeps dark assets aligned with the resolver", () => {
    const darkAssetKeys = readdirSync(DashboardIntegrationLogoDirectory)
      .filter((fileName) => fileName.endsWith("-dark.svg"))
      .map((fileName) => fileName.replace(/-dark\.svg$/, ""))
      .sort();

    for (const logoKey of listDashboardLightAssetLogoKeys()) {
      const expectedPath = darkAssetKeys.includes(logoKey)
        ? `/integration-logos/${logoKey}-dark.svg`
        : `/integration-logos/${logoKey}.svg`;
      expect(resolveIntegrationLogoPath({ logoKey, colorScheme: "dark" })).toBe(expectedPath);
    }
  });

  it("has a usable SVG viewport for every dashboard logo asset", () => {
    for (const fileName of readdirSync(DashboardIntegrationLogoDirectory)) {
      if (!fileName.endsWith(".svg")) {
        continue;
      }

      const { height, width } = readSvgViewBoxDimensions(fileName);
      expect(width, `${fileName} viewBox width should be positive`).toBeGreaterThan(0);
      expect(height, `${fileName} viewBox height should be positive`).toBeGreaterThan(0);
    }
  });

  it("keeps dashboard SVG logo assets self-contained", () => {
    for (const fileName of readdirSync(DashboardIntegrationLogoDirectory)) {
      if (!fileName.endsWith(".svg")) {
        continue;
      }

      const contents = readFileSync(join(DashboardIntegrationLogoDirectory, fileName), "utf8");
      expect(
        contents,
        `${fileName} should not reference remote image or script assets`,
      ).not.toMatch(/\b(?:href|src)\s*=\s*["']https?:\/\//);
    }
  });

  it("keeps the AWS logo square so it does not regress to the wide wordmark", () => {
    const { height, width } = readSvgViewBoxDimensions("aws.svg");

    expect(width).toBe(40);
    expect(height).toBe(40);
  });

  it("keeps the DeepSeek logo square so it does not regress to the wide wordmark", () => {
    const { height, width } = readSvgViewBoxDimensions("deepseek.svg");

    expect(width).toBe(24);
    expect(height).toBe(24);
  });

  it("keeps the WasenderAPI logo square and opaque for light and dark surfaces", () => {
    const { colorType, height, width } = readPngHeader("wasenderapi.png");

    expect(width).toBe(512);
    expect(height).toBe(512);
    expect(colorType).toBe(2);
  });
});
