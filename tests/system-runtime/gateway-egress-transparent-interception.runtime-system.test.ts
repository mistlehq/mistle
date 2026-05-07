/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended Vitest fixture created by the system test harness.
 */

import { createSystemTest, type RuntimeSystemTestEnvironment } from "@mistle/test-harness/system";
import { describe, expect } from "vitest";

import {
  prepareCodexSandbox,
  runSandboxExecCommandInSandbox,
  stopSandboxInstance,
} from "../system/helpers/codex-sandbox.js";
import { createRuntimeCodexSandboxFixture } from "./helpers/runtime-codex-sandbox.js";
import type { SandboxSystemTestProvider } from "./helpers/sandbox-system-test.js";

const dockerIt = createSystemTest({
  extraInfra: ["mailpit"],
  sandbox: {
    provider: "docker",
  },
  gatewayProxy: true,
});

const e2bIt = createSystemTest({
  extraInfra: ["mailpit"],
  sandbox: {
    provider: "e2b",
  },
  gatewayProxy: true,
  publicAccess: {
    provider: "cloudflare",
    services: ["data-plane-gateway", "tokenizer-proxy"],
  },
});

const SYSTEM_TEST_TIMEOUT_MS = 10 * 60_000;
const TRANSPARENT_PROXY_TABLE_NAME = "mistle_transparent_egress";
const TRANSPARENT_PROXY_PORT = "38514";
const TRANSPARENT_INTERCEPTION_MARKER = "MISTLE_TRANSPARENT_INTERCEPTION_OK";
const LOOPBACK_DIRECT_MARKER = "MISTLE_TRANSPARENT_LOOPBACK_DIRECT_OK";
const COMMAND_CONTROL_MARKER = "MISTLE_TRANSPARENT_COMMAND_CONTROL_OK";
const TRANSPARENT_COUNTER_MARKER = "MISTLE_TRANSPARENT_COUNTER_OBSERVED";
const HTTPS_TRANSPARENT_SMOKE_URL = "https://example.com/";

describe("runtime system gateway transparent egress interception", () => {
  dockerIt(
    "installs provider packet rules and preserves opaque TCP passthrough [docker]",
    async ({ system }) => {
      await runTransparentInterceptionScenario({
        system,
        sandboxProvider: "docker",
      });
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );

  e2bIt(
    "installs provider packet rules and preserves opaque TCP passthrough [e2b]",
    async ({ system }) => {
      await runTransparentInterceptionScenario({
        system,
        sandboxProvider: "e2b",
      });
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );
});

async function runTransparentInterceptionScenario(input: {
  system: RuntimeSystemTestEnvironment;
  sandboxProvider: SandboxSystemTestProvider;
}): Promise<void> {
  const fixture = createRuntimeCodexSandboxFixture(input.system);
  let sandboxInstanceIdForCleanup: string | undefined;

  try {
    const { authenticatedSession, sandboxInstanceId } = await prepareCodexSandbox({
      fixture,
      email: `runtime-transparent-egress-${input.sandboxProvider}@example.com`,
    });
    sandboxInstanceIdForCleanup = sandboxInstanceId;

    const smokeScript =
      input.sandboxProvider === "e2b"
        ? transparentHttpsInterceptionSmokeScript()
        : transparentOpaqueTcpInterceptionSmokeScript();
    const smokeResult = await runSandboxExecCommandInSandbox({
      fixture,
      authenticatedSession,
      sandboxInstanceId,
      command: "bash",
      args: ["-lc", smokeScript],
      timeoutMs: 90_000,
    });

    if (smokeResult.exitCode !== 0) {
      throw new Error(
        `Transparent egress smoke failed with exit code ${String(smokeResult.exitCode)}. stdout=${smokeResult.stdout} stderr=${smokeResult.stderr}`,
      );
    }
    if (input.sandboxProvider === "docker") {
      expect(smokeResult.stdout).toContain(LOOPBACK_DIRECT_MARKER);
    }
    expect(smokeResult.stdout).toContain(TRANSPARENT_INTERCEPTION_MARKER);
    expect(smokeResult.stdout).toContain(TRANSPARENT_COUNTER_MARKER);
    expect(smokeResult.stdout).toContain(COMMAND_CONTROL_MARKER);
  } finally {
    if (sandboxInstanceIdForCleanup !== undefined) {
      await stopSandboxInstance({
        fixture,
        sandboxInstanceId: sandboxInstanceIdForCleanup,
      });
    }
  }
}

function transparentOpaqueTcpInterceptionSmokeScript(): string {
  return [
    transparentPacketRuleAssertionScript(),
    "sandbox_ip=$(ip -4 route get 1.1.1.1 | awk '{ for (i = 1; i <= NF; i += 1) if ($i == \"src\") { print $(i + 1); exit } }')",
    "if [ -z \"${sandbox_ip}\" ]; then printf 'failed to resolve sandbox IPv4 source address\\n' >&2; exit 1; fi",
    "port_file=$(mktemp)",
    "perl -MIO::Socket::INET - \"${port_file}\" <<'PERL' &",
    "use strict;",
    "use warnings;",
    "use IO::Socket::INET;",
    "my $port_file = $ARGV[0];",
    "my $server = IO::Socket::INET->new(LocalAddr => '0.0.0.0', LocalPort => 0, Proto => 'tcp', Listen => 2, Reuse => 1) or die \"failed to start transparent smoke server: $!\";",
    "open(my $handle, '>', $port_file) or die \"failed to write transparent smoke port: $!\";",
    "print $handle $server->sockport;",
    "close($handle);",
    "for my $index (1..2) {",
    '  my $client = $server->accept() or die "failed to accept transparent smoke client: $!";',
    "  my $payload = '';",
    "  $client->recv($payload, 65536);",
    "  if ($payload =~ /^\\0(.*)$/s) {",
    '    print $client "transparent:$1";',
    "  } else {",
    '    print $client "direct:$payload";',
    "  }",
    "  close($client);",
    "}",
    "close($server);",
    "PERL",
    "server_pid=$!",
    'cleanup() { kill "${server_pid}" 2>/dev/null || true; }',
    "trap cleanup EXIT",
    'while [ ! -s "${port_file}" ]; do sleep 0.05; done',
    'server_port=$(cat "${port_file}")',
    'perl -MIO::Socket::INET - "127.0.0.1" "${server_port}" <<\'PERL\'',
    "use strict;",
    "use warnings;",
    "use IO::Socket::INET;",
    "my ($host, $port) = @ARGV;",
    "my $client = IO::Socket::INET->new(PeerHost => $host, PeerPort => $port, Proto => 'tcp') or die \"loopback connect failed: $!\";",
    'print $client "loopback";',
    "my $response = '';",
    "$client->recv($response, 65536);",
    "die \"unexpected loopback response: $response\" unless $response eq 'direct:loopback';",
    "PERL",
    `printf '%s\\n' ${shellQuote(LOOPBACK_DIRECT_MARKER)}`,
    'perl -MIO::Socket::INET - "${sandbox_ip}" "${server_port}" <<\'PERL\'',
    "use strict;",
    "use warnings;",
    "use IO::Socket::INET;",
    "my ($host, $port) = @ARGV;",
    "my $client = IO::Socket::INET->new(PeerHost => $host, PeerPort => $port, Proto => 'tcp') or die \"transparent connect failed: $!\";",
    'print $client "\\0opaque";',
    "my $response = '';",
    "$client->recv($response, 65536);",
    "die \"unexpected transparent response: $response\" unless $response eq 'transparent:opaque';",
    "PERL",
    `printf '%s\\n' ${shellQuote(TRANSPARENT_INTERCEPTION_MARKER)}`,
    transparentCounterAssertionScript(),
    `printf '%s\\n' ${shellQuote(COMMAND_CONTROL_MARKER)}`,
  ].join("\n");
}

function transparentHttpsInterceptionSmokeScript(): string {
  return [
    transparentPacketRuleAssertionScript(),
    [
      "curl",
      "-4",
      "-fsS",
      "--max-time",
      "30",
      shellQuote(HTTPS_TRANSPARENT_SMOKE_URL),
      "| grep -q 'Example Domain'",
    ].join(" "),
    `printf '%s\\n' ${shellQuote(TRANSPARENT_INTERCEPTION_MARKER)}`,
    transparentCounterAssertionScript(),
    `printf '%s\\n' ${shellQuote(COMMAND_CONTROL_MARKER)}`,
  ].join("\n");
}

function transparentPacketRuleAssertionScript(): string {
  return [
    "set -euo pipefail",
    "unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy",
    `nft list table ip ${TRANSPARENT_PROXY_TABLE_NAME} > /tmp/mistle-transparent-egress-rules.txt`,
    `grep -q 'table ip ${TRANSPARENT_PROXY_TABLE_NAME}' /tmp/mistle-transparent-egress-rules.txt`,
    "grep -Eq 'meta mark (38514|0x0*9672) return' /tmp/mistle-transparent-egress-rules.txt",
    "grep -q 'ip daddr 127.0.0.0/8 return' /tmp/mistle-transparent-egress-rules.txt",
    `grep -q 'tcp dport 1-65535 redirect to :${TRANSPARENT_PROXY_PORT}' /tmp/mistle-transparent-egress-rules.txt`,
    `ss -ltn | grep -q ':${TRANSPARENT_PROXY_PORT} '`,
    "redirect_handle=$(nft -a list chain ip mistle_transparent_egress output | awk '/redirect to :38514/ { print $NF; exit }')",
    'if [ -z "${redirect_handle}" ]; then printf "failed to find transparent redirect rule handle\\n" >&2; nft -a list chain ip mistle_transparent_egress output >&2; exit 1; fi',
    'nft insert rule ip mistle_transparent_egress output position "${redirect_handle}" tcp dport 1-65535 counter comment "mistle-transparent-smoke-counter"',
  ].join("\n");
}

function transparentCounterAssertionScript(): string {
  return [
    "counter_packets=$(nft -a list chain ip mistle_transparent_egress output | awk '/mistle-transparent-smoke-counter/ { for (i = 1; i <= NF; i += 1) if ($i == \"packets\") { print $(i + 1); exit } }')",
    'if [ -z "${counter_packets}" ]; then printf "failed to read transparent smoke counter\\n" >&2; nft -a list chain ip mistle_transparent_egress output >&2; exit 1; fi',
    'if [ "${counter_packets}" -le 0 ]; then printf "transparent smoke counter did not observe redirected traffic\\n" >&2; nft -a list chain ip mistle_transparent_egress output >&2; exit 1; fi',
    `printf '%s\\n' ${shellQuote(TRANSPARENT_COUNTER_MARKER)}`,
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
