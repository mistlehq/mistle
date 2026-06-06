package cli

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	mstlcore "github.com/mistle/mstl-core"
)

func TestVersionFlagsPrintPackageVersion(t *testing.T) {
	for _, flag := range []string{"--version", "-V"} {
		stdout, stderr, code := runCLI(t, []string{flag})
		assertEqual(t, code, 0)
		assertEqual(t, stdout, "Version: 0.31.0\n\n")
		assertEqual(t, stderr, "")
	}
}

func TestUpdateHelpDescribesTheUpdateCommandWithoutRunningIt(t *testing.T) {
	stdout, stderr, code := runCLI(t, []string{"update", "--help"})

	assertEqual(t, code, 0)
	assertEqual(t, stderr, "")
	if !strings.Contains(stdout, "Update the Mistle CLI") || !strings.Contains(stdout, "Usage: mistle update") {
		t.Fatalf("expected update help text, got %q", stdout)
	}
}

func TestCommandsRequireAuthentication(t *testing.T) {
	for _, args := range [][]string{
		{"whoami"},
		{"org", "list"},
		{"profile", "list"},
		{"profile", "get", "sbp_test"},
		{"profile", "version", "list", "--profile", "sbp_test"},
		{"sandbox", "create", "--profile", "sbp_test"},
		{"sandbox", "list"},
		{"sandbox", "get", "sbi_test"},
		{"codex", "--sandbox", "sbi_test", "--", "--model", "gpt-5.2"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			stdout, stderr, code := runCLI(t, args)

			assertEqual(t, code, 1)
			assertEqual(t, stdout, "")
			assertEqual(t, stderr, "missing Mistle authentication; run `mistle login` or set MISTLE_API_KEY\n")
		})
	}
}

func TestWhoamiRejectsBlankEnvironmentVariables(t *testing.T) {
	t.Setenv(mstlcore.APIKeyEnvVar, " ")
	t.Setenv(mstlcore.ControlPlaneAPIPublicURLEnvVar, "https://api.example.test")

	stdout, stderr, code := runCLIWithoutEnvReset([]string{"whoami"})

	assertEqual(t, code, 1)
	assertEqual(t, stdout, "")
	assertEqual(t, stderr, "MISTLE_API_KEY cannot be blank\n")

	t.Setenv(mstlcore.APIKeyEnvVar, "mstl_test_key")
	t.Setenv(mstlcore.ControlPlaneAPIPublicURLEnvVar, " ")

	stdout, stderr, code = runCLIWithoutEnvReset([]string{"whoami"})

	assertEqual(t, code, 1)
	assertEqual(t, stdout, "")
	assertEqual(t, stderr, "MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL cannot be blank\n")
}

func TestOrgSwitchRequiresOAuthAuthentication(t *testing.T) {
	stdout, stderr, code := runCLI(t, []string{"org", "switch", "first"})

	assertEqual(t, code, 1)
	assertEqual(t, stdout, "")
	assertEqual(t, stderr, "organization switching requires `mistle login`; API key authentication cannot be switched\n")

	configHome := isolatedConfigHome(t)
	writeAuthFile(t, configHome, `{"authMode":"api_key","apiKey":"mstl_apk_test"}`)
	t.Setenv("XDG_CONFIG_HOME", configHome)

	stdout, stderr, code = runCLIWithoutEnvReset([]string{"org", "switch", "first"})

	assertEqual(t, code, 1)
	assertEqual(t, stdout, "")
	assertEqual(t, stderr, "organization switching requires `mistle login`; API key authentication cannot be switched\n")
}

func TestOrgSwitchRejectsAPIKeyEnvBeforeOAuthAuthFile(t *testing.T) {
	configHome := isolatedConfigHome(t)
	writeAuthFile(t, configHome, `{"authMode":"oauth","oauth":{"accessToken":"mstl_oat_access","refreshToken":"mstl_ort_refresh","expiresAt":9999999999,"scope":"organization:read"}}`)
	t.Setenv("XDG_CONFIG_HOME", configHome)
	t.Setenv(mstlcore.APIKeyEnvVar, "mstl_apk_test")
	os.Unsetenv(mstlcore.ControlPlaneAPIPublicURLEnvVar)

	stdout, stderr, code := runCLIWithoutEnvReset([]string{"org", "switch", "first"})

	assertEqual(t, code, 1)
	assertEqual(t, stdout, "")
	assertEqual(t, stderr, "organization switching requires `mistle login`; API key authentication cannot be switched\n")
}

func TestProfileVersionSetupScriptSetRejectsEmptyFileBeforeAuth(t *testing.T) {
	scriptFile := filepath.Join(t.TempDir(), "setup.sh")
	requireNoError(t, os.WriteFile(scriptFile, []byte(""), 0o600))
	t.Setenv(mstlcore.APIKeyEnvVar, "mstl_test_key")
	t.Setenv(mstlcore.ControlPlaneAPIPublicURLEnvVar, "http://127.0.0.1:1")

	stdout, stderr, code := runCLIWithoutEnvReset([]string{
		"profile", "version", "setup-script", "set",
		"--profile", "sbp_test",
		"--version", "1",
		"--file", scriptFile,
	})

	assertEqual(t, code, 1)
	assertEqual(t, stdout, "")
	assertEqual(t, stderr, "file `"+scriptFile+"` cannot be empty\n")
}

func TestCodexRejectsUserSuppliedRemoteBeforeReadingAuth(t *testing.T) {
	stdout, stderr, code := runCLI(t, []string{
		"codex", "--sandbox", "sbi_test", "--", "--remote", "ws://127.0.0.1:1",
	})

	assertEqual(t, code, 1)
	assertEqual(t, stdout, "")
	assertEqual(t, stderr, "failed to validate codex arguments: codex arguments must not include --remote; mistle manages the remote endpoint\n")
}

func runCLI(t *testing.T, args []string) (string, string, int) {
	t.Helper()
	configHome := isolatedConfigHome(t)
	t.Setenv("XDG_CONFIG_HOME", configHome)
	os.Unsetenv(mstlcore.APIKeyEnvVar)
	os.Unsetenv(mstlcore.ControlPlaneAPIPublicURLEnvVar)
	return runCLIWithoutEnvReset(args)
}

func runCLIWithoutEnvReset(args []string) (string, string, int) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := Main(args, &stdout, &stderr)
	return stdout.String(), stderr.String(), code
}

func isolatedConfigHome(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "config")
}

func writeAuthFile(t *testing.T, configHome string, contents string) {
	t.Helper()
	authDirectory := filepath.Join(configHome, "mistle")
	requireNoError(t, os.MkdirAll(authDirectory, 0o700))
	requireNoError(t, os.WriteFile(filepath.Join(authDirectory, "auth.json"), []byte(contents), 0o600))
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
