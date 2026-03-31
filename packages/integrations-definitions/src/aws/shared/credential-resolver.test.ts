import { describe, expect, it } from "vitest";

import {
  buildAwsAssumeRoleSessionName,
  resolveAwsAssumeRoleCredentialContext,
} from "./credential-resolver.js";

describe("AWS assume-role credential resolver", () => {
  it("derives the STS context from connection, binding, and linked credential input", () => {
    expect(
      resolveAwsAssumeRoleCredentialContext({
        organizationId: "org_123",
        targetKey: "aws-cli-default",
        connectionId: "icn_123",
        target: {
          familyId: "aws",
          variantId: "aws-cli-default",
          enabled: true,
          config: {},
          secrets: {},
        },
        connection: {
          id: "icn_123",
          status: "active",
          config: {
            connection_method: "aws-assume-role",
            accessKeyId: "AKIA1234567890",
            roleArn: "arn:aws:iam::123456789012:role/mistle-sandbox",
            externalId: "external-123",
            durationSeconds: 3600,
          },
        },
        binding: {
          id: "ibd_123",
          kind: "agent",
          config: {
            services: ["sts"],
            regions: ["us-east-1"],
            defaultRegion: "us-east-1",
          },
        },
        secretType: "aws_secret_access_key",
        purpose: "aws_secret_access_key",
        linkedCredential: {
          secretType: "aws_secret_access_key",
          purpose: "aws_secret_access_key",
          value: "bootstrap-secret-access-key",
        },
      }),
    ).toEqual({
      accessKeyId: "AKIA1234567890",
      secretAccessKey: "bootstrap-secret-access-key",
      roleArn: "arn:aws:iam::123456789012:role/mistle-sandbox",
      defaultRegion: "us-east-1",
      roleSessionName: "mistle-icn_123-ibd_123",
      externalId: "external-123",
      durationSeconds: 3600,
    });
  });

  it("requires linked bootstrap credentials", () => {
    expect(() =>
      resolveAwsAssumeRoleCredentialContext({
        organizationId: "org_123",
        targetKey: "aws-cli-default",
        connectionId: "icn_123",
        target: {
          familyId: "aws",
          variantId: "aws-cli-default",
          enabled: true,
          config: {},
          secrets: {},
        },
        connection: {
          id: "icn_123",
          status: "active",
          config: {
            connection_method: "aws-assume-role",
            accessKeyId: "AKIA1234567890",
            roleArn: "arn:aws:iam::123456789012:role/mistle-sandbox",
          },
        },
        binding: {
          id: "ibd_123",
          kind: "agent",
          config: {
            services: ["sts"],
            regions: ["us-east-1"],
            defaultRegion: "us-east-1",
          },
        },
        secretType: "aws_secret_access_key",
      }),
    ).toThrow("AWS assume-role resolver requires linked bootstrap credentials.");
  });

  it("requires binding config context", () => {
    expect(() =>
      resolveAwsAssumeRoleCredentialContext({
        organizationId: "org_123",
        targetKey: "aws-cli-default",
        connectionId: "icn_123",
        target: {
          familyId: "aws",
          variantId: "aws-cli-default",
          enabled: true,
          config: {},
          secrets: {},
        },
        connection: {
          id: "icn_123",
          status: "active",
          config: {
            connection_method: "aws-assume-role",
            accessKeyId: "AKIA1234567890",
            roleArn: "arn:aws:iam::123456789012:role/mistle-sandbox",
          },
        },
        secretType: "aws_secret_access_key",
        linkedCredential: {
          secretType: "aws_secret_access_key",
          value: "bootstrap-secret-access-key",
        },
      }),
    ).toThrow("AWS assume-role resolver requires binding config context.");
  });

  it("sanitizes and truncates generated session names", () => {
    const connectionId = "icn_123/with spaces and symbols!!!";
    const bindingId = "ibd_123/with even more symbols and spaces to force truncation";

    const sessionName = buildAwsAssumeRoleSessionName({
      connectionId,
      bindingId,
    });

    expect(sessionName).toMatch(/^mistle-/u);
    expect(sessionName).not.toMatch(/[ /!]/u);
    expect(sessionName.length).toBeLessThanOrEqual(64);
  });
});
