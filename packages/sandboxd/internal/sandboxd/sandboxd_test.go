package sandboxd

import (
	"bytes"
	"strings"
	"testing"
)

func TestParseCommandDefaultsToDaemon(t *testing.T) {
	command, err := ParseCommand(nil)
	requireNoError(t, err)
	assertEqual(t, command.Kind, CommandDaemon)
}

func TestParseCommandRecognizesLifecycleSubcommands(t *testing.T) {
	for _, input := range []struct {
		args []string
		kind CommandKind
	}{
		{args: []string{"ready"}, kind: CommandReady},
		{args: []string{"shutdown"}, kind: CommandShutdown},
		{args: []string{"version"}, kind: CommandVersion},
	} {
		command, err := ParseCommand(input.args)
		requireNoError(t, err)
		assertEqual(t, command.Kind, input.kind)
	}
}

func TestParseCommandReadsActivateStdinByteCount(t *testing.T) {
	command, err := ParseCommand([]string{"activate", "--stdin-bytes", "42"})
	requireNoError(t, err)

	assertEqual(t, command.Kind, CommandActivate)
	assertEqual(t, command.ActivatePayloadSource.Kind, StartupPayloadBytes)
	assertEqual(t, command.ActivatePayloadSource.ByteCount, 42)
}

func TestParseCommandRejectsInvalidStdinByteCount(t *testing.T) {
	_, err := ParseCommand([]string{"activate", "--stdin-bytes", "bad"})

	assertError(t, err, "sandboxd --stdin-bytes must be a non-negative integer: bad")
}

func TestParseCommandReadsEgressProxyConfigPath(t *testing.T) {
	command, err := ParseCommand([]string{"egress-proxy", "--config", "/tmp/config.json"})
	requireNoError(t, err)

	assertEqual(t, command.Kind, CommandEgressProxy)
	assertEqual(t, command.EgressProxyConfigPath, "/tmp/config.json")
}

func TestParseCommandRejectsUnexpectedArgument(t *testing.T) {
	_, err := ParseCommand([]string{"ready", "--extra"})

	assertError(t, err, "unexpected sandboxd argument: --extra")
}

func TestRunVersionPrintsVersion(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	code := Run("sandboxd", []string{"version"}, strings.NewReader(""), &stdout, &stderr)

	assertEqual(t, code, 0)
	assertEqual(t, stdout.String(), "0.31.0\n")
	assertEqual(t, stderr.String(), "")
}

func TestSignerAliasSelectsSignCommand(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	code := Run("/opt/mistle/bin/mistle-ssh-sign", []string{"version"}, strings.NewReader(""), &stdout, &stderr)

	assertEqual(t, code, 1)
	assertEqual(t, stdout.String(), "")
	assertEqual(t, stderr.String(), "sandboxd sign is not ported to Go yet\n")
}

func TestReadStartupPayloadUntilEOF(t *testing.T) {
	payload, err := ReadStartupPayload(strings.NewReader("payload"), StartupPayloadSource{Kind: StartupPayloadUntilEOF})
	requireNoError(t, err)

	assertEqual(t, string(payload), "payload")
}

func TestReadStartupPayloadExactByteCountLeavesTrailingBytes(t *testing.T) {
	reader := strings.NewReader("payload-trailing")
	payload, err := ReadStartupPayload(reader, StartupPayloadSource{Kind: StartupPayloadBytes, ByteCount: 7})
	requireNoError(t, err)

	trailing := make([]byte, reader.Len())
	_, err = reader.Read(trailing)
	requireNoError(t, err)
	assertEqual(t, string(payload), "payload")
	assertEqual(t, string(trailing), "-trailing")
}

func TestReadStartupPayloadExactByteCountRequiresEnoughBytes(t *testing.T) {
	_, err := ReadStartupPayload(strings.NewReader("short"), StartupPayloadSource{Kind: StartupPayloadBytes, ByteCount: 6})

	assertError(t, err, "startup payload stdin ended after 5 bytes, expected 6")
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func assertError(t *testing.T, err error, expected string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error %q, got nil", expected)
	}
	assertEqual(t, err.Error(), expected)
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
