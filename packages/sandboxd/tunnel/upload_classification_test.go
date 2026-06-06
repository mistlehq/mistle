package tunnel

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

func TestClassifyUploadedFileDetectsSupportedImagesFromContent(t *testing.T) {
	for _, input := range []struct {
		name      string
		declared  string
		bytes     []byte
		extension string
	}{
		{name: "png", declared: "image/png", bytes: []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, extension: "png"},
		{name: "jpeg", declared: "image/jpeg", bytes: []byte{0xff, 0xd8, 0xff, 0x00}, extension: "jpg"},
		{name: "gif", declared: "image/gif", bytes: []byte("GIF89a"), extension: "gif"},
		{name: "webp", declared: "image/webp", bytes: []byte{'R', 'I', 'F', 'F', 0, 0, 0, 0, 'W', 'E', 'B', 'P'}, extension: "webp"},
	} {
		t.Run(input.name, func(t *testing.T) {
			path := writeUpload(t, input.bytes)

			classification, err := ClassifyUploadedFile(input.declared, path, "upload.bin")
			requireNoError(t, err)

			assertEqual(t, classification.Kind, UploadedFileKindImage)
			assertEqual(t, classification.Extension, input.extension)
		})
	}
}

func TestClassifyUploadedFileRejectsDeclaredImageWithoutImageSignature(t *testing.T) {
	path := writeUpload(t, []byte("not an image"))

	_, err := ClassifyUploadedFile("image/png", path, "image.png")

	var reset UploadClassificationResetError
	if !errors.As(err, &reset) {
		t.Fatalf("expected reset error, got %v", err)
	}
	assertEqual(t, reset.Code, tunnelprotocol.FileUploadResetCodeInvalidFileType)
	assertEqual(t, reset.Message, "uploaded file is not a supported image")
}

func TestClassifyUploadedFileRejectsImageMimeMismatch(t *testing.T) {
	path := writeUpload(t, []byte{0xff, 0xd8, 0xff, 0x00})

	_, err := ClassifyUploadedFile("image/png", path, "image.png")

	var reset UploadClassificationResetError
	if !errors.As(err, &reset) {
		t.Fatalf("expected reset error, got %v", err)
	}
	assertEqual(t, reset.Code, tunnelprotocol.FileUploadResetCodeMimeTypeMismatch)
	assertEqual(t, reset.Message, "uploaded file content is 'image/jpeg', which does not match declared MIME type 'image/png'")
}

func TestClassifyUploadedFileUsesSanitizedGenericExtension(t *testing.T) {
	for _, input := range []struct {
		name      string
		filename  string
		extension string
	}{
		{name: "lowercase", filename: "notes.TXT", extension: "txt"},
		{name: "path", filename: "../secret.pdf", extension: "bin"},
		{name: "backslash", filename: `..\secret.pdf`, extension: "bin"},
		{name: "long", filename: "archive.thisextensionistoolong", extension: "bin"},
		{name: "symbol", filename: "archive.tar.gz", extension: "gz"},
		{name: "none", filename: "README", extension: "bin"},
	} {
		t.Run(input.name, func(t *testing.T) {
			path := writeUpload(t, []byte("plain text"))

			classification, err := ClassifyUploadedFile("text/plain", path, input.filename)
			requireNoError(t, err)

			assertEqual(t, classification.Kind, UploadedFileKindFile)
			assertEqual(t, classification.Extension, input.extension)
		})
	}
}

func writeUpload(t *testing.T, contents []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "upload")
	requireNoError(t, os.WriteFile(path, contents, 0o600))
	return path
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
