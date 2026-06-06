package sandboxdstate

import (
	"os"
	"path/filepath"
	"testing"
)

func TestScrubSnapshotRuntimeArtifactsRemovesRuntimeDirectoryAndTrustStoreFile(t *testing.T) {
	tempRoot := t.TempDir()
	runtimeDirectory := filepath.Join(tempRoot, "run/mistle")
	trustStoreCertificatePath := filepath.Join(tempRoot, "usr/local/share/ca-certificates/mistle-egress-proxy-ca.crt")
	requireNoError(t, os.MkdirAll(filepath.Join(runtimeDirectory, "sandboxd"), 0o700))
	requireNoError(t, os.MkdirAll(filepath.Dir(trustStoreCertificatePath), 0o700))
	requireNoError(t, os.WriteFile(filepath.Join(runtimeDirectory, "activate.log"), []byte("diagnostics"), 0o600))
	requireNoError(t, os.WriteFile(trustStoreCertificatePath, []byte("cert"), 0o600))

	requireNoError(t, ScrubSnapshotRuntimeArtifactsAtPaths(runtimeDirectory, trustStoreCertificatePath))

	if _, err := os.Stat(runtimeDirectory); !os.IsNotExist(err) {
		t.Fatalf("expected runtime directory to be removed, got %v", err)
	}
	if _, err := os.Stat(trustStoreCertificatePath); !os.IsNotExist(err) {
		t.Fatalf("expected trust-store certificate to be removed, got %v", err)
	}
}

func TestScrubSnapshotRuntimeArtifactsIgnoresMissingPaths(t *testing.T) {
	tempRoot := t.TempDir()

	requireNoError(t, ScrubSnapshotRuntimeArtifactsAtPaths(filepath.Join(tempRoot, "missing-runtime"), filepath.Join(tempRoot, "missing-cert.crt")))
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}
