package runtime

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mistle/sandboxd/protocol"
)

func TestApplyGitIdentityWritesGlobalGitConfig(t *testing.T) {
	globalConfigPath := filepath.Join(t.TempDir(), "gitconfig")
	sessionInput := gitIdentitySessionInput(&protocol.GitIdentity{
		Name:  "Mistle User",
		Email: "mistle-user@example.com",
	})

	requireNoError(t, ApplyGitIdentity(sessionInput, globalConfigPath))

	gitConfig := readRuntimeFile(t, globalConfigPath)
	assertContains(t, gitConfig, "name = Mistle User")
	assertContains(t, gitConfig, "email = mistle-user@example.com")
	if strings.Contains(gitConfig, "gpg.ssh.program") {
		t.Fatalf("expected unsigned Git identity to clear signing program, got %s", gitConfig)
	}
}

func TestApplyGitIdentityWritesSigningGlobalGitConfig(t *testing.T) {
	globalConfigPath := filepath.Join(t.TempDir(), "gitconfig")
	sessionInput := gitIdentitySessionInput(&protocol.GitIdentity{
		Name:  "Mistle User",
		Email: "mistle-user@example.com",
		Signing: &protocol.GitSigningConfig{
			Format:       "ssh",
			Program:      "/opt/mistle/bin/mistle-ssh-sign",
			KeyRef:       "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE",
			ActingUserID: "usr_123",
		},
	})

	requireNoError(t, ApplyGitIdentity(sessionInput, globalConfigPath))

	gitConfig := readRuntimeFile(t, globalConfigPath)
	assertContains(t, gitConfig, "format = ssh")
	assertContains(t, gitConfig, "program = /opt/mistle/bin/mistle-ssh-sign")
	assertContains(t, gitConfig, "signingkey = key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE")
}

func TestApplyGitIdentityClearsExistingConfigWhenIdentityIsAbsent(t *testing.T) {
	globalConfigPath := filepath.Join(t.TempDir(), "gitconfig")
	requireNoError(t, applyGlobalGitConfig(globalConfigPath, "user.name", "Rejected User"))
	requireNoError(t, applyGlobalGitConfig(globalConfigPath, "user.email", "rejected@example.com"))
	requireNoError(t, applyGlobalGitConfig(globalConfigPath, "gpg.format", "ssh"))
	requireNoError(t, applyGlobalGitConfig(globalConfigPath, "gpg.ssh.program", "/tmp/rejected"))
	requireNoError(t, applyGlobalGitConfig(globalConfigPath, "user.signingkey", "key::rejected"))

	requireNoError(t, ApplyGitIdentity(gitIdentitySessionInput(nil), globalConfigPath))

	gitConfig := readRuntimeFile(t, globalConfigPath)
	if strings.Contains(gitConfig, "Rejected User") || strings.Contains(gitConfig, "rejected@example.com") || strings.Contains(gitConfig, "key::rejected") {
		t.Fatalf("expected Git identity config to be cleared, got %s", gitConfig)
	}
}

func gitIdentitySessionInput(gitIdentity *protocol.GitIdentity) protocol.SessionRuntimeInput {
	return protocol.SessionRuntimeInput{
		BootstrapToken:      "bootstrap-token",
		TunnelExchangeToken: "exchange-token",
		TunnelGatewayWSURL:  "ws://gateway.example.test/tunnel/sbi_git_identity",
		RuntimePlan:         []byte(`{"sandboxProfileId":"sbp_git","version":1}`),
		GitIdentity:         gitIdentity,
	}
}

func readRuntimeFile(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	requireNoError(t, err)
	return string(content)
}

func assertContains(t *testing.T, value string, expected string) {
	t.Helper()
	if !strings.Contains(value, expected) {
		t.Fatalf("expected %q to contain %q", value, expected)
	}
}
