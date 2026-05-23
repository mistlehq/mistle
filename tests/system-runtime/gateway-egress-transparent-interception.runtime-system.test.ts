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
});

const e2bIt = createSystemTest({
  extraInfra: ["mailpit"],
  sandbox: {
    provider: "e2b",
  },
  publicAccess: {
    provider: "cloudflare",
    services: ["data-plane-gateway"],
  },
});

const SYSTEM_TEST_TIMEOUT_MS = 10 * 60_000;
const TRANSPARENT_PROXY_TABLE_NAME = "mistle_transparent_egress";
const TRANSPARENT_PROXY_PORT = "38514";
const TRANSPARENT_INTERCEPTION_MARKER = "MISTLE_TRANSPARENT_INTERCEPTION_OK";
const LOOPBACK_DIRECT_MARKER = "MISTLE_TRANSPARENT_LOOPBACK_DIRECT_OK";
const COMMAND_CONTROL_MARKER = "MISTLE_TRANSPARENT_COMMAND_CONTROL_OK";
const TRANSPARENT_COUNTER_MARKER = "MISTLE_TRANSPARENT_COUNTER_OBSERVED";
const TRANSPARENT_DIRECT_TLS_CLIENT_MARKER = "MISTLE_TRANSPARENT_DIRECT_TLS_CLIENT_OK";
const TRANSPARENT_COUNTER_COMMENT = "mistle-transparent-smoke-counter";
const HTTPS_TRANSPARENT_SMOKE_URL = "https://example.com/";
const HTTPS_TRANSPARENT_SMOKE_HOST = "example.com";

describe("runtime system gateway transparent egress interception", () => {
  dockerIt(
    "installs provider packet rules and preserves transparent HTTPS plus opaque TCP passthrough [docker]",
    async ({ system }) => {
      await runTransparentInterceptionScenario({
        system,
        sandboxProvider: "docker",
      });
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );

  e2bIt(
    "installs provider packet rules and preserves transparent HTTPS while command traffic stays reachable [e2b]",
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
    expect(smokeResult.stdout).toContain(TRANSPARENT_DIRECT_TLS_CLIENT_MARKER);
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
    transparentDirectTlsClientInterceptionScript(),
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
    transparentDirectTlsClientInterceptionScript(),
    transparentCounterAssertionScript(),
    `printf '%s\\n' ${shellQuote(COMMAND_CONTROL_MARKER)}`,
  ].join("\n");
}

function transparentDirectTlsClientInterceptionScript(): string {
  return [
    [
      `printf 'GET / HTTP/1.1\\r\\nHost: ${HTTPS_TRANSPARENT_SMOKE_HOST}\\r\\nConnection: close\\r\\n\\r\\n'`,
      "|",
      "openssl",
      "s_client",
      "-quiet",
      "-verify_return_error",
      "-connect",
      `${HTTPS_TRANSPARENT_SMOKE_HOST}:443`,
      "-servername",
      HTTPS_TRANSPARENT_SMOKE_HOST,
      "2>/tmp/mistle-transparent-openssl-stderr.txt",
      "| grep -q 'Example Domain'",
    ].join(" "),
    `printf '%s\\n' ${shellQuote(TRANSPARENT_DIRECT_TLS_CLIENT_MARKER)}`,
  ].join("\n");
}

function transparentPacketRuleAssertionScript(): string {
  return [
    "set -euo pipefail",
    transparentCounterDiagnosticsFunctionScript(),
    "unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy",
    `nft list table ip ${TRANSPARENT_PROXY_TABLE_NAME} > /tmp/mistle-transparent-egress-rules.txt`,
    "assertTransparentRule() {",
    '  transparent_rule_pattern="${1}"',
    '  transparent_rule_description="${2}"',
    '  if ! grep -Eq "${transparent_rule_pattern}" /tmp/mistle-transparent-egress-rules.txt; then',
    '    printf "missing transparent nft rule: %s\\npattern: %s\\n" "${transparent_rule_description}" "${transparent_rule_pattern}" >&2',
    "    dumpTransparentCounterDiagnostics >&2",
    "    exit 1",
    "  fi",
    "}",
    `assertTransparentRule 'table ip ${TRANSPARENT_PROXY_TABLE_NAME}' 'transparent egress table'`,
    "assertTransparentRule 'meta mark (38514|0x0*9672).* return' 'socket-mark passthrough bypass'",
    "if ! grep -Eq 'ip daddr 127\\.0\\.0\\.0/8.* return' /tmp/mistle-transparent-egress-rules.txt; then",
    "  assertTransparentRule 'set local_destinations' 'local destination bypass set'",
    "  assertTransparentRule '127\\.0\\.0\\.0/8' 'loopback destination bypass set element'",
    "  assertTransparentRule 'ip daddr @local_destinations.* return' 'local destination bypass rule'",
    "fi",
    `assertTransparentRule 'tcp dport 1-65535 redirect to :${TRANSPARENT_PROXY_PORT}' 'transparent TCP redirect'`,
    `ss -ltn | grep -q ':${TRANSPARENT_PROXY_PORT} '`,
    `nft -a list chain ip ${TRANSPARENT_PROXY_TABLE_NAME} output > /tmp/mistle-transparent-egress-output-chain-before-counter.txt`,
    `redirect_handle=$(awk '/redirect to :${TRANSPARENT_PROXY_PORT}/ { print $NF; exit }' /tmp/mistle-transparent-egress-output-chain-before-counter.txt)`,
    `if [ -z "\${redirect_handle}" ]; then printf "failed to find transparent redirect rule handle\\n" >&2; nft -a list chain ip ${TRANSPARENT_PROXY_TABLE_NAME} output >&2; exit 1; fi`,
    [
      "nft insert rule ip",
      TRANSPARENT_PROXY_TABLE_NAME,
      'output position "${redirect_handle}" tcp dport 1-65535 counter comment',
      shellQuote(TRANSPARENT_COUNTER_COMMENT),
    ].join(" "),
    "nft -a list chain ip mistle_transparent_egress output > /tmp/mistle-transparent-egress-output-chain-with-counter.txt",
    `grep -q ${shellQuote(TRANSPARENT_COUNTER_COMMENT)} /tmp/mistle-transparent-egress-output-chain-with-counter.txt`,
  ].join("\n");
}

function transparentCounterAssertionScript(): string {
  return [
    "read_transparent_counter_packets() {",
    `  nft -a list chain ip ${TRANSPARENT_PROXY_TABLE_NAME} output > /tmp/mistle-transparent-egress-output-chain-counter-read.txt`,
    `  awk '/${TRANSPARENT_COUNTER_COMMENT}/ { for (i = 1; i <= NF; i += 1) if ($i == "packets") { print $(i + 1); exit } }' /tmp/mistle-transparent-egress-output-chain-counter-read.txt`,
    "}",
    "counter_packets=",
    "counter_read_status=0",
    "counter_read_stderr=/tmp/mistle-transparent-counter-read-stderr.txt",
    'rm -f "${counter_read_stderr}"',
    "for counter_attempt in 1 2 3 4 5 6 7 8 9 10; do",
    '  if counter_packets=$(read_transparent_counter_packets 2>"${counter_read_stderr}"); then',
    "    counter_read_status=0",
    "  else",
    "    counter_read_status=$?",
    "  fi",
    '  if [ -n "${counter_packets}" ] && [ "${counter_packets}" -gt 0 ]; then',
    "    break",
    "  fi",
    "  sleep 0.25",
    "done",
    'if [ "${counter_read_status}" -ne 0 ]; then',
    '  printf "failed to read transparent smoke counter; nft counter read exited with status %s\\n" "${counter_read_status}" >&2',
    '  cat "${counter_read_stderr}" >&2 || true',
    "  dumpTransparentCounterDiagnostics >&2",
    "  exit 1",
    "fi",
    'if [ -z "${counter_packets}" ]; then',
    '  printf "failed to read transparent smoke counter; nft output did not contain a packets field for the smoke counter\\n" >&2',
    "  dumpTransparentCounterDiagnostics >&2",
    "  exit 1",
    "fi",
    'if [ "${counter_packets}" -le 0 ]; then',
    '  printf "transparent smoke counter did not observe redirected traffic; packets=%s\\n" "${counter_packets}" >&2',
    "  dumpTransparentCounterDiagnostics >&2",
    "  exit 1",
    "fi",
    `printf '%s\\n' ${shellQuote(TRANSPARENT_COUNTER_MARKER)}`,
  ].join("\n");
}

function transparentCounterDiagnosticsFunctionScript(): string {
  return [
    "dumpTransparentCounterDiagnostics() {",
    "  printf '%s\\n' '--- transparent egress nft table ---'",
    `  nft -a list table ip ${TRANSPARENT_PROXY_TABLE_NAME} || true`,
    "  printf '%s\\n' '--- transparent egress output chain ---'",
    `  nft -a list chain ip ${TRANSPARENT_PROXY_TABLE_NAME} output || true`,
    "  printf '%s\\n' '--- transparent egress saved initial table ---'",
    "  cat /tmp/mistle-transparent-egress-rules.txt 2>/dev/null || true",
    "  printf '%s\\n' '--- transparent egress saved output chain before counter ---'",
    "  cat /tmp/mistle-transparent-egress-output-chain-before-counter.txt 2>/dev/null || true",
    "  printf '%s\\n' '--- transparent egress saved output chain with counter ---'",
    "  cat /tmp/mistle-transparent-egress-output-chain-with-counter.txt 2>/dev/null || true",
    "  printf '%s\\n' '--- transparent egress latest counter read chain ---'",
    "  cat /tmp/mistle-transparent-egress-output-chain-counter-read.txt 2>/dev/null || true",
    "  printf '%s\\n' '--- transparent egress counter read stderr ---'",
    "  cat /tmp/mistle-transparent-counter-read-stderr.txt 2>/dev/null || true",
    "  printf '%s\\n' '--- process and route diagnostics ---'",
    "  id || true",
    "  ip -4 route || true",
    "  ss -ltn || true",
    "  printf '%s\\n' '--- openssl stderr ---'",
    "  cat /tmp/mistle-transparent-openssl-stderr.txt 2>/dev/null || true",
    "}",
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
