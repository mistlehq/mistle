package runtime

import (
	"os"
	"path/filepath"
	"testing"
)

func TestApplyRuntimeFileWritesContentAndMode(t *testing.T) {
	targetPath := filepath.Join(t.TempDir(), "nested/config.txt")

	outcome, err := ApplyRuntimeFile(RuntimeClientSetupFile{
		FileID:  "config",
		Path:    targetPath,
		Mode:    0o640,
		Content: "hello\n",
	})

	requireNoError(t, err)
	assertEqual(t, outcome, RuntimeFileApplyOutcomeWritten)
	assertEqual(t, readFile(t, targetPath), "hello\n")
	assertEqual(t, fileMode(t, targetPath), os.FileMode(0o640))
}

func TestApplyRuntimeFileSkipsExistingIfAbsentFile(t *testing.T) {
	targetPath := filepath.Join(t.TempDir(), "settings.json")
	requireNoError(t, os.WriteFile(targetPath, []byte("existing"), 0o600))
	writeMode := RuntimeFileWriteModeIfAbsent

	outcome, err := ApplyRuntimeFile(RuntimeClientSetupFile{
		FileID:    "settings",
		Path:      targetPath,
		Mode:      0o644,
		Content:   "generated",
		WriteMode: &writeMode,
	})

	requireNoError(t, err)
	assertEqual(t, outcome, RuntimeFileApplyOutcomeSkippedIfAbsent)
	assertEqual(t, readFile(t, targetPath), "existing")
	assertEqual(t, fileMode(t, targetPath), os.FileMode(0o600))
}

func TestApplyRuntimeFileMergesJSONObjectAndExtensionArray(t *testing.T) {
	targetPath := filepath.Join(t.TempDir(), "settings.json")
	requireNoError(t, os.WriteFile(targetPath, []byte(`{"extensions":["vim"],"mcp":{"old":{"command":"old"}},"theme":"dark"}`), 0o600))
	writeMode := RuntimeFileWriteModeMerge

	_, err := ApplyRuntimeFile(RuntimeClientSetupFile{
		FileID:    "settings",
		Path:      targetPath,
		Mode:      0o644,
		Content:   `{"extensions":["vim","go"],"mcp":{"new":{"command":"new"}}}`,
		WriteMode: &writeMode,
	})

	requireNoError(t, err)
	assertEqual(t, readFile(t, targetPath), "{\n  \"extensions\": [\n    \"vim\",\n    \"go\"\n  ],\n  \"mcp\": {\n    \"new\": {\n      \"command\": \"new\"\n    },\n    \"old\": {\n      \"command\": \"old\"\n    }\n  },\n  \"theme\": \"dark\"\n}\n")
}

func TestApplyRuntimeFileMergesTOMLKeysAndSections(t *testing.T) {
	targetPath := filepath.Join(t.TempDir(), "config.toml")
	requireNoError(t, os.WriteFile(targetPath, []byte("theme = \"dark\"\n\n[editor]\nfont = \"mono\"\n"), 0o600))
	writeMode := RuntimeFileWriteModeMerge

	_, err := ApplyRuntimeFile(RuntimeClientSetupFile{
		FileID: "config",
		Path:   targetPath,
		Mode:   0o644,
		Content: `theme = "light"

[editor]
line_numbers = true
`,
		WriteMode: &writeMode,
	})

	requireNoError(t, err)
	assertEqual(t, readFile(t, targetPath), "theme = \"light\"\n\n[editor]\nfont = \"mono\"\nline_numbers = true\n")
}

func TestApplyRuntimeFileReplacesManagedBlock(t *testing.T) {
	targetPath := filepath.Join(t.TempDir(), "config.md")
	requireNoError(t, os.WriteFile(targetPath, []byte("before\n<!-- MISTLE-MANAGED:START mistle-sandbox-context -->\nold\n<!-- MISTLE-MANAGED:END mistle-sandbox-context -->\nafter\n"), 0o600))
	writeMode := RuntimeFileWriteModeMerge

	_, err := ApplyRuntimeFile(RuntimeClientSetupFile{
		FileID: "config",
		Path:   targetPath,
		Mode:   0o644,
		Content: `<!-- MISTLE-MANAGED:START mistle-sandbox-context -->
new
<!-- MISTLE-MANAGED:END mistle-sandbox-context -->`,
		WriteMode: &writeMode,
	})

	requireNoError(t, err)
	assertEqual(t, readFile(t, targetPath), "before\n<!-- MISTLE-MANAGED:START mistle-sandbox-context -->\nnew\n<!-- MISTLE-MANAGED:END mistle-sandbox-context -->\nafter\n")
}

func TestApplyRuntimeFileRejectsUnsupportedMergeFormat(t *testing.T) {
	targetPath := filepath.Join(t.TempDir(), "config.txt")
	requireNoError(t, os.WriteFile(targetPath, []byte("existing"), 0o600))
	writeMode := RuntimeFileWriteModeMerge

	_, err := ApplyRuntimeFile(RuntimeClientSetupFile{
		FileID:    "config",
		Path:      targetPath,
		Mode:      0o644,
		Content:   "generated",
		WriteMode: &writeMode,
	})

	if err == nil {
		t.Fatalf("expected unsupported merge format to fail")
	}
	assertEqual(t, err.Error(), "runtime file "+targetPath+" uses writeMode merge, but sandboxd could not infer a supported merge format")
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	requireNoError(t, err)
	return string(content)
}

func fileMode(t *testing.T, path string) os.FileMode {
	t.Helper()
	metadata, err := os.Stat(path)
	requireNoError(t, err)
	return metadata.Mode().Perm()
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}
