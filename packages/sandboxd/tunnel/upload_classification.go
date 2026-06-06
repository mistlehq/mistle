package tunnel

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

const (
	UploadedFileKindImage    = "image"
	UploadedFileKindFile     = "file"
	defaultUploadExtension   = "bin"
	maxUploadExtensionLength = 16
)

var (
	pngSignature       = []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}
	jpegSignature      = []byte{0xff, 0xd8, 0xff}
	gif87aSignature    = []byte{0x47, 0x49, 0x46, 0x38, 0x37, 0x61}
	gif89aSignature    = []byte{0x47, 0x49, 0x46, 0x38, 0x39, 0x61}
	webpRiffSignature  = []byte{0x52, 0x49, 0x46, 0x46}
	webpBrandSignature = []byte{0x57, 0x45, 0x42, 0x50}
)

type UploadedFileClassification struct {
	Kind      string
	Extension string
}

type UploadClassificationResetError struct {
	Code    string
	Message string
}

func (err UploadClassificationResetError) Error() string {
	return err.Message
}

func ClassifyUploadedFile(declaredMimeType string, tempPath string, originalFilename string) (UploadedFileClassification, error) {
	file, err := os.Open(tempPath)
	if err != nil {
		return UploadedFileClassification{}, fmt.Errorf("failed to open temporary upload file %s: %w", tempPath, err)
	}
	defer file.Close()

	signatureBytes := make([]byte, 12)
	bytesRead, err := file.Read(signatureBytes)
	if err != nil {
		return UploadedFileClassification{}, fmt.Errorf("failed to read upload signature from %s: %w", tempPath, err)
	}
	detectedMimeType, detected := detectSupportedImageMimeType(signatureBytes[:bytesRead])
	declaredImageExtension, declaredImage := resolveImageExtension(declaredMimeType)
	if detected {
		if declaredImage && detectedMimeType != declaredMimeType {
			return UploadedFileClassification{}, UploadClassificationResetError{
				Code:    tunnelprotocol.FileUploadResetCodeMimeTypeMismatch,
				Message: fmt.Sprintf("uploaded file content is '%s', which does not match declared MIME type '%s'", detectedMimeType, declaredMimeType),
			}
		}
		extension, _ := resolveImageExtension(detectedMimeType)
		return UploadedFileClassification{Kind: UploadedFileKindImage, Extension: extension}, nil
	}
	if declaredImage {
		_ = declaredImageExtension
		return UploadedFileClassification{}, UploadClassificationResetError{
			Code:    tunnelprotocol.FileUploadResetCodeInvalidFileType,
			Message: "uploaded file is not a supported image",
		}
	}
	return UploadedFileClassification{
		Kind:      UploadedFileKindFile,
		Extension: resolveGenericUploadExtension(originalFilename),
	}, nil
}

func resolveImageExtension(mimeType string) (string, bool) {
	switch mimeType {
	case "image/png":
		return "png", true
	case "image/jpeg":
		return "jpg", true
	case "image/webp":
		return "webp", true
	case "image/gif":
		return "gif", true
	default:
		return "", false
	}
}

func resolveGenericUploadExtension(originalFilename string) string {
	if strings.Contains(originalFilename, "/") || strings.Contains(originalFilename, "\\") {
		return defaultUploadExtension
	}
	extension := filepath.Ext(originalFilename)
	if extension == "" {
		return defaultUploadExtension
	}
	normalized := strings.ToLower(strings.TrimPrefix(extension, "."))
	if normalized == "" || len(normalized) > maxUploadExtensionLength {
		return defaultUploadExtension
	}
	for _, character := range normalized {
		if !((character >= 'a' && character <= 'z') || (character >= '0' && character <= '9')) {
			return defaultUploadExtension
		}
	}
	return normalized
}

func detectSupportedImageMimeType(bytes []byte) (string, bool) {
	if matchesSignature(bytes, 0, pngSignature) {
		return "image/png", true
	}
	if matchesSignature(bytes, 0, jpegSignature) {
		return "image/jpeg", true
	}
	if matchesSignature(bytes, 0, gif87aSignature) || matchesSignature(bytes, 0, gif89aSignature) {
		return "image/gif", true
	}
	if matchesSignature(bytes, 0, webpRiffSignature) && matchesSignature(bytes, 8, webpBrandSignature) {
		return "image/webp", true
	}
	return "", false
}

func matchesSignature(bytes []byte, offset int, signature []byte) bool {
	if len(bytes) < offset+len(signature) {
		return false
	}
	for index, value := range signature {
		if bytes[offset+index] != value {
			return false
		}
	}
	return true
}
