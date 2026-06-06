package cli

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const githubReleaseDownloadBaseURL = "https://github.com/mistlehq/mistle/releases/latest/download"

func runUpdate(stdout io.Writer) error {
	outcome, err := updateCurrentExecutable()
	if err != nil {
		return err
	}
	if outcome.Updated {
		_, err = fmt.Fprintf(stdout, "Updated Mistle CLI from %s to %s: %s\n", outcome.PreviousVersion, outcome.UpdatedVersion, outcome.ExecutablePath)
		return err
	}
	_, err = fmt.Fprintf(stdout, "Mistle CLI is already up to date (%s).\n", outcome.PreviousVersion)
	return err
}

type updateOutcome struct {
	Updated         bool
	PreviousVersion string
	UpdatedVersion  string
	ExecutablePath  string
}

func updateCurrentExecutable() (updateOutcome, error) {
	target, err := releaseTarget()
	if err != nil {
		return updateOutcome{}, err
	}
	assetName := releaseAssetName(target)
	assetURL := latestReleaseAssetURL(assetName)
	checksumURL := latestReleaseAssetURL(assetName + ".sha256")
	executablePath, err := os.Executable()
	if err != nil {
		return updateOutcome{}, fmt.Errorf("failed to resolve current executable: %w", err)
	}

	downloadedBinary, err := downloadReleaseAsset(assetURL)
	if err != nil {
		return updateOutcome{}, err
	}
	expectedChecksum, err := downloadReleaseChecksum(checksumURL)
	if err != nil {
		return updateOutcome{}, err
	}
	actualChecksum := sha256Hex(downloadedBinary)
	if actualChecksum != expectedChecksum {
		return updateOutcome{}, fmt.Errorf("downloaded asset checksum mismatch for %s: expected %s, got %s", assetURL, expectedChecksum, actualChecksum)
	}

	temporaryPath, err := temporaryBinaryPath(executablePath)
	if err != nil {
		return updateOutcome{}, err
	}
	if err := writeDownloadedBinary(temporaryPath, downloadedBinary); err != nil {
		return updateOutcome{}, err
	}
	removeTemporary := true
	defer func() {
		if removeTemporary {
			_ = os.Remove(temporaryPath)
		}
	}()

	downloadedVersion, err := readBinaryVersion(temporaryPath)
	if err != nil {
		return updateOutcome{}, err
	}
	versionOrder, err := compareVersions(downloadedVersion, Version)
	if err != nil {
		return updateOutcome{}, err
	}
	if versionOrder == 0 {
		return updateOutcome{PreviousVersion: Version}, nil
	}
	if versionOrder < 0 {
		return updateOutcome{}, fmt.Errorf("downloaded version %s is older than current version %s", downloadedVersion, Version)
	}
	if err := os.Rename(temporaryPath, executablePath); err != nil {
		return updateOutcome{}, fmt.Errorf("failed to replace current executable: %w", err)
	}
	removeTemporary = false
	return updateOutcome{
		Updated:         true,
		PreviousVersion: Version,
		UpdatedVersion:  downloadedVersion,
		ExecutablePath:  executablePath,
	}, nil
}

func releaseTarget() (string, error) {
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "linux/amd64":
		return "x86_64-unknown-linux-gnu", nil
	case "linux/arm64":
		return "aarch64-unknown-linux-gnu", nil
	case "darwin/amd64":
		return "x86_64-apple-darwin", nil
	case "darwin/arm64":
		return "aarch64-apple-darwin", nil
	default:
		return "", fmt.Errorf("unsupported platform: %s/%s", runtime.GOOS, runtime.GOARCH)
	}
}

func releaseAssetName(target string) string {
	return "mistle-cli-" + target
}

func latestReleaseAssetURL(assetName string) string {
	return githubReleaseDownloadBaseURL + "/" + assetName
}

func downloadReleaseAsset(rawURL string) ([]byte, error) {
	response, err := http.Get(rawURL)
	if err != nil {
		return nil, fmt.Errorf("request failed for %s: %w", rawURL, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("request failed for %s: unexpected status %d", rawURL, response.StatusCode)
	}
	bytes, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response for %s: %w", rawURL, err)
	}
	return bytes, nil
}

func downloadReleaseChecksum(rawURL string) (string, error) {
	bytes, err := downloadReleaseAsset(rawURL)
	if err != nil {
		return "", err
	}
	checksum := strings.Fields(string(bytes))
	if len(checksum) == 0 || !isSHA256Hex(checksum[0]) {
		return "", fmt.Errorf("invalid checksum file: %s", rawURL)
	}
	return checksum[0], nil
}

func sha256Hex(bytes []byte) string {
	digest := sha256.Sum256(bytes)
	return hex.EncodeToString(digest[:])
}

func isSHA256Hex(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, character := range value {
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F')) {
			return false
		}
	}
	return true
}

func temporaryBinaryPath(executablePath string) (string, error) {
	executableDirectory := filepath.Dir(executablePath)
	if executableDirectory == "." || executableDirectory == "" {
		return "", errors.New("current executable path is missing a directory")
	}
	return filepath.Join(executableDirectory, fmt.Sprintf(".mistle-update-%d-%d", os.Getpid(), time.Now().UnixNano())), nil
}

func writeDownloadedBinary(path string, binary []byte) error {
	if err := os.WriteFile(path, binary, 0o755); err != nil {
		return fmt.Errorf("failed to write downloaded binary `%s`: %w", path, err)
	}
	return nil
}

func readBinaryVersion(path string) (string, error) {
	output, err := exec.Command(path, "--version").Output()
	if err != nil {
		return "", fmt.Errorf("failed to run downloaded binary `%s`: %w", path, err)
	}
	version, ok := parseVersionOutput(output)
	if !ok {
		return "", fmt.Errorf("invalid downloaded binary version output from `%s`: %s", path, string(output))
	}
	return version, nil
}

func parseVersionOutput(stdout []byte) (string, bool) {
	firstLine, _, _ := strings.Cut(string(stdout), "\n")
	version, ok := strings.CutPrefix(firstLine, "Version: ")
	if !ok || strings.TrimSpace(version) != version || version == "" {
		return "", false
	}
	return version, true
}

func compareVersions(left string, right string) (int, error) {
	leftVersion, err := parseReleaseVersion(left)
	if err != nil {
		return 0, err
	}
	rightVersion, err := parseReleaseVersion(right)
	if err != nil {
		return 0, err
	}
	for index := range leftVersion {
		if leftVersion[index] < rightVersion[index] {
			return -1, nil
		}
		if leftVersion[index] > rightVersion[index] {
			return 1, nil
		}
	}
	return 0, nil
}

func parseReleaseVersion(version string) ([3]int, error) {
	parts := strings.Split(version, ".")
	if len(parts) != 3 {
		return [3]int{}, fmt.Errorf("invalid version: %s", version)
	}
	parsed := [3]int{}
	for index, part := range parts {
		value, err := strconv.Atoi(part)
		if err != nil || value < 0 {
			return [3]int{}, fmt.Errorf("invalid version: %s", version)
		}
		parsed[index] = value
	}
	return parsed, nil
}
