package cli

import "testing"

func TestReleaseAssetNameUsesTargetTriple(t *testing.T) {
	assertEqual(t, releaseAssetName("aarch64-apple-darwin"), "mistle-cli-aarch64-apple-darwin")
}

func TestParseVersionOutput(t *testing.T) {
	version, ok := parseVersionOutput([]byte("Version: 0.31.0\n\n"))

	assertEqual(t, ok, true)
	assertEqual(t, version, "0.31.0")
}

func TestCompareVersions(t *testing.T) {
	order, err := compareVersions("0.32.0", "0.31.9")
	requireNoError(t, err)
	assertEqual(t, order, 1)

	order, err = compareVersions("0.31.0", "0.31.0")
	requireNoError(t, err)
	assertEqual(t, order, 0)

	order, err = compareVersions("0.30.9", "0.31.0")
	requireNoError(t, err)
	assertEqual(t, order, -1)
}

func TestIsSHA256Hex(t *testing.T) {
	assertEqual(t, isSHA256Hex("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"), true)
	assertEqual(t, isSHA256Hex("not-a-checksum"), false)
}
