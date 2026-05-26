import {
  type PortAccessBootstrapTokenConfig,
  PortAccessBootstrapTokenError,
  PortAccessBootstrapTokenErrorCode,
  type PortAccessHostConfig,
  PortAccessHostError,
  PortAccessHostErrorCode,
  parsePortAccessHost,
  verifyPortAccessBootstrapToken,
} from "@mistle/port-access-auth";
import type { Clock } from "@mistle/time";

import { BootstrapTunnelNotConnectedError } from "../tunnel/bootstrap-tunnel-not-connected-error.js";
import { GatewayForwardingPortAccessAuthorizationError } from "../tunnel/gateway-forwarding/types.js";
import {
  createPortAccessSessionSetCookieHeader,
  type PortAccessSessionConfig,
  mintPortAccessSession,
} from "./auth/port-access-session.js";
import {
  PortsTargetAuthorizeBootstrapDisconnectedError,
  PortsTargetAuthorizeService,
  PortsTargetAuthorizeTimedOutError,
} from "./ports-target-authorize-service.js";

export type PortAccessBootstrapSuccess = {
  kind: "success";
  location: "/";
  setCookieHeader: string;
};

export type PortAccessBootstrapFailure = {
  kind: "failure";
  status: 400 | 401 | 403 | 409 | 502;
  message: string;
};

export type PortAccessBootstrapResult = PortAccessBootstrapSuccess | PortAccessBootstrapFailure;

function isHttpsRequest(input: { url: string; forwardedProto: string | undefined }): boolean {
  if (input.forwardedProto === "https") {
    return true;
  }

  return new URL(input.url).protocol === "https:";
}

function toTokenFailure(error: unknown): PortAccessBootstrapFailure {
  if (error instanceof PortAccessBootstrapTokenError) {
    if (
      error.code === PortAccessBootstrapTokenErrorCode.TOKEN_REQUIRED ||
      error.code === PortAccessBootstrapTokenErrorCode.TOKEN_EXPIRED ||
      error.code === PortAccessBootstrapTokenErrorCode.TOKEN_INVALID_AUDIENCE ||
      error.code === PortAccessBootstrapTokenErrorCode.TOKEN_INVALID_CLAIMS ||
      error.code === PortAccessBootstrapTokenErrorCode.TOKEN_INVALID_ISSUER ||
      error.code === PortAccessBootstrapTokenErrorCode.TOKEN_VERIFICATION_FAILED ||
      error.code === PortAccessBootstrapTokenErrorCode.HOST_REQUIRED ||
      error.code === PortAccessBootstrapTokenErrorCode.PORT_INVALID ||
      error.code === PortAccessBootstrapTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED
    ) {
      return {
        kind: "failure",
        status: 401,
        message: "Invalid or expired Port Access bootstrap token.",
      };
    }
  }

  throw error;
}

export async function bootstrapPortAccess(input: {
  bootstrapTokenConfig: PortAccessBootstrapTokenConfig;
  hostConfig: PortAccessHostConfig;
  sessionConfig: PortAccessSessionConfig;
  portsTargetAuthorizeService: PortsTargetAuthorizeService;
  clock: Clock;
  requestUrl: string;
  requestHost: string | undefined;
  token: string | undefined;
  forwardedProto: string | undefined;
}): Promise<PortAccessBootstrapResult> {
  const token = input.token?.trim();
  if (token === undefined || token.length === 0) {
    return {
      kind: "failure",
      status: 400,
      message: "Port Access bootstrap token query parameter is required.",
    };
  }

  let verifiedBootstrapToken;
  try {
    verifiedBootstrapToken = await verifyPortAccessBootstrapToken({
      config: input.bootstrapTokenConfig,
      token,
    });
  } catch (error) {
    return toTokenFailure(error);
  }

  const requestHost = input.requestHost?.trim();
  if (requestHost === undefined || requestHost.length === 0) {
    return {
      kind: "failure",
      status: 403,
      message: "Port Access host does not match bootstrap token.",
    };
  }

  let parsedHost;
  try {
    parsedHost = parsePortAccessHost({
      config: input.hostConfig,
      host: requestHost,
    });
  } catch (error) {
    if (
      error instanceof PortAccessHostError &&
      (error.code === PortAccessHostErrorCode.HOST_REQUIRED ||
        error.code === PortAccessHostErrorCode.HOST_FORMAT_INVALID ||
        error.code === PortAccessHostErrorCode.HOST_SANDBOX_ID_INVALID)
    ) {
      return {
        kind: "failure",
        status: 403,
        message: "Port Access host does not match bootstrap token.",
      };
    }

    throw error;
  }

  if (
    parsedHost.host !== verifiedBootstrapToken.host ||
    parsedHost.sandboxInstanceId !== verifiedBootstrapToken.sandboxInstanceId ||
    parsedHost.port !== verifiedBootstrapToken.port
  ) {
    return {
      kind: "failure",
      status: 403,
      message: "Port Access host does not match bootstrap token.",
    };
  }

  try {
    const authorizeResult = await input.portsTargetAuthorizeService.requestTargetAuthorize({
      sandboxInstanceId: verifiedBootstrapToken.sandboxInstanceId,
      target: {
        kind: "port",
        port: verifiedBootstrapToken.port,
      },
    });
    if (!authorizeResult.authorized) {
      return {
        kind: "failure",
        status: 409,
        message: authorizeResult.reason,
      };
    }

    const sessionToken = await mintPortAccessSession({
      config: input.sessionConfig,
      clock: input.clock,
      sandboxInstanceId: verifiedBootstrapToken.sandboxInstanceId,
      port: verifiedBootstrapToken.port,
      host: verifiedBootstrapToken.host,
      upstreamProtocol: authorizeResult.upstreamProtocol,
    });

    return {
      kind: "success",
      location: "/",
      setCookieHeader: createPortAccessSessionSetCookieHeader({
        token: sessionToken,
        secure: isHttpsRequest({
          url: input.requestUrl,
          forwardedProto: input.forwardedProto,
        }),
      }),
    };
  } catch (error) {
    if (
      error instanceof BootstrapTunnelNotConnectedError ||
      error instanceof PortsTargetAuthorizeTimedOutError ||
      error instanceof PortsTargetAuthorizeBootstrapDisconnectedError ||
      error instanceof GatewayForwardingPortAccessAuthorizationError
    ) {
      return {
        kind: "failure",
        status: 502,
        message: "Port Access authorization failed.",
      };
    }

    throw error;
  }
}
