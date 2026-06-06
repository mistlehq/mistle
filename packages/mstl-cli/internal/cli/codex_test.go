package cli

import (
	"slices"
	"testing"
)

func TestCodexCommandArgsInsertRemoteBeforeInteractiveArgs(t *testing.T) {
	args, err := codexCommandArgs("ws://127.0.0.1:1234", []string{"--model", "gpt-5.2"})
	requireNoError(t, err)

	expected := []string{
		"-c",
		"model_provider=\"mistle-remote\"",
		"-c",
		codexMistleModelProviderConfig,
		"--remote",
		"ws://127.0.0.1:1234",
		"--model",
		"gpt-5.2",
	}
	if !slices.Equal(args, expected) {
		t.Fatalf("expected %v, got %v", expected, args)
	}
}

func TestCodexCommandArgsInsertRemoteAfterResumeSubcommand(t *testing.T) {
	args, err := codexCommandArgs("ws://127.0.0.1:1234", []string{"resume", "thread_01"})
	requireNoError(t, err)

	expected := []string{
		"resume",
		"-c",
		"model_provider=\"mistle-remote\"",
		"-c",
		codexMistleModelProviderConfig,
		"--remote",
		"ws://127.0.0.1:1234",
		"thread_01",
	}
	if !slices.Equal(args, expected) {
		t.Fatalf("expected %v, got %v", expected, args)
	}
}

func TestCodexCommandArgsRejectUserSuppliedRemoteArg(t *testing.T) {
	_, err := codexCommandArgs("ws://127.0.0.1:1234", []string{"--remote"})

	assertError(t, err, "codex arguments must not include --remote; mistle manages the remote endpoint")
}

func TestRenderLocalCodexConfigIncludesNoAuthPermissionsAndProjectTrust(t *testing.T) {
	config, err := renderLocalCodexConfig()
	requireNoError(t, err)

	for _, expected := range []string{
		"approval_policy = \"never\"",
		"sandbox_mode = \"danger-full-access\"",
		"trust_level = \"trusted\"",
	} {
		if !slices.Contains(splitConfigLines(config), expected) && !contains(config, expected) {
			t.Fatalf("expected config to contain %q:\n%s", expected, config)
		}
	}
}

func TestTomlStringEscapesSpecialCharacters(t *testing.T) {
	assertEqual(t, tomlString("path\\with\"quote\nnext"), "\"path\\\\with\\\"quote\\nnext\"")
}

func TestEncodeAndDecodeWebSocketTextDataFrame(t *testing.T) {
	encoded, err := encodeDataFrame(7, payloadKindWebSocketText, []byte(`{"jsonrpc":"2.0"}`))
	requireNoError(t, err)

	expected := []byte{
		0x01, 0x00, 0x00, 0x00, 0x07, 0x02, '{', '"', 'j', 's', 'o', 'n', 'r', 'p',
		'c', '"', ':', '"', '2', '.', '0', '"', '}',
	}
	if !slices.Equal(encoded, expected) {
		t.Fatalf("expected %v, got %v", expected, encoded)
	}

	decoded, err := decodeDataFrame(encoded)
	requireNoError(t, err)
	assertEqual(t, decoded.StreamID, uint32(7))
	assertEqual(t, decoded.PayloadKind, payloadKindWebSocketText)
	assertEqual(t, string(decoded.Payload), `{"jsonrpc":"2.0"}`)
}

func TestDecodeWebSocketBinaryDataFrame(t *testing.T) {
	decoded, err := decodeDataFrame([]byte{0x01, 0x00, 0x00, 0x00, 0x09, 0x03, 0xaa, 0xbb})
	requireNoError(t, err)

	assertEqual(t, decoded.StreamID, uint32(9))
	assertEqual(t, decoded.PayloadKind, payloadKindWebSocketBytes)
	if !slices.Equal(decoded.Payload, []byte{0xaa, 0xbb}) {
		t.Fatalf("expected binary payload, got %v", decoded.Payload)
	}
}

func splitConfigLines(config string) []string {
	lines := []string{}
	current := ""
	for _, character := range config {
		if character == '\n' {
			lines = append(lines, current)
			current = ""
			continue
		}
		current += string(character)
	}
	if current != "" {
		lines = append(lines, current)
	}
	return lines
}

func contains(value string, expected string) bool {
	return len(expected) == 0 || (len(value) >= len(expected) && indexOf(value, expected) >= 0)
}

func indexOf(value string, expected string) int {
	for index := 0; index+len(expected) <= len(value); index++ {
		if value[index:index+len(expected)] == expected {
			return index
		}
	}
	return -1
}

func assertError(t *testing.T, err error, expected string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error %q, got nil", expected)
	}
	if err.Error() != expected {
		t.Fatalf("expected error %q, got %q", expected, err.Error())
	}
}
