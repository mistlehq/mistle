package sandboxdstate

import (
	"errors"
	"fmt"
	"os"
)

const (
	SnapshotRuntimeArtifactsDirectory = "/run/mistle"
	SnapshotTrustStoreCertPath        = "/usr/local/share/ca-certificates/mistle-egress-proxy-ca.crt"
)

func ScrubSnapshotRuntimeArtifacts() error {
	return ScrubSnapshotRuntimeArtifactsAtPaths(SnapshotRuntimeArtifactsDirectory, SnapshotTrustStoreCertPath)
}

func ScrubSnapshotRuntimeArtifactsAtPaths(runtimeArtifactsDirectory string, trustStoreCertificatePath string) error {
	if err := os.RemoveAll(runtimeArtifactsDirectory); err != nil {
		return fmt.Errorf("failed to remove snapshot runtime artifacts directory %q: %w", runtimeArtifactsDirectory, err)
	}

	if err := os.Remove(trustStoreCertificatePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("failed to remove snapshot trust-store certificate %q: %w", trustStoreCertificatePath, err)
	}
	return nil
}
