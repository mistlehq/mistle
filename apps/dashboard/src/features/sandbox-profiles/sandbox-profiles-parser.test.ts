import { describe, expect, it } from "vitest";

import {
  parseSandboxProfile,
  parseSandboxProfilesListResult,
  readSandboxProfilesErrorMessage,
} from "./sandbox-profiles-parser.js";

describe("sandbox profiles parser", () => {
  it("parses a valid sandbox profile", () => {
    const parsed = parseSandboxProfile({
      id: "sbp_123",
      organizationId: "org_123",
      displayName: "Main profile",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(parsed).toEqual({
      id: "sbp_123",
      organizationId: "org_123",
      displayName: "Main profile",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("returns null for invalid sandbox profile status", () => {
    expect(
      parseSandboxProfile({
        id: "sbp_123",
        organizationId: "org_123",
        displayName: "Main profile",
        status: "unknown",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("parses a valid keyset list response", () => {
    const parsed = parseSandboxProfilesListResult({
      totalResults: 2,
      items: [
        {
          id: "sbp_002",
          organizationId: "org_123",
          displayName: "Second",
          status: "inactive",
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:00.000Z",
        },
        {
          id: "sbp_001",
          organizationId: "org_123",
          displayName: "First",
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      nextPage: {
        after: "next-cursor",
        limit: 20,
      },
      previousPage: null,
    });

    expect(parsed).toEqual({
      totalResults: 2,
      items: [
        {
          id: "sbp_002",
          organizationId: "org_123",
          displayName: "Second",
          status: "inactive",
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:00.000Z",
        },
        {
          id: "sbp_001",
          organizationId: "org_123",
          displayName: "First",
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      nextPage: {
        after: "next-cursor",
        limit: 20,
      },
      previousPage: null,
    });
  });

  it("returns null when list envelope is malformed", () => {
    expect(
      parseSandboxProfilesListResult({
        totalResults: "2",
        items: [],
        nextPage: null,
        previousPage: null,
      }),
    ).toBeNull();
  });

  it("extracts message from API error payloads", () => {
    expect(readSandboxProfilesErrorMessage({ message: "Invalid request." })).toBe(
      "Invalid request.",
    );
    expect(
      readSandboxProfilesErrorMessage({
        error: {
          message: "Nested error",
        },
      }),
    ).toBe("Nested error");
    expect(readSandboxProfilesErrorMessage(null)).toBeNull();
  });
});
