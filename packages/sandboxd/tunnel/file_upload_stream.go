package tunnel

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"

	"github.com/mistle/sandboxd/timeutil"
	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

const (
	DefaultAttachmentRoot     = "/root/.local/attachments"
	maxUploadSizeBytes        = 16 * 1024 * 1024
	maxUploadThreadIDLength   = 128
	fileUploadAttachmentIDTag = "att"
)

var uploadIDCounter atomic.Uint64

type fileUploadState struct {
	attachmentID        string
	threadDirectoryPath string
	threadID            string
	mimeType            string
	originalFilename    string
	sizeBytes           uint64
	tempPath            string
	file                *os.File
	receivedBytes       uint64
}

type completedFileUpload struct {
	kind             string
	attachmentID     string
	threadID         string
	originalFilename string
	mimeType         string
	sizeBytes        uint64
	path             string
}

func CreateFileUploadState(channel tunnelprotocol.StreamChannel, attachmentRoot string, clock timeutil.Clock) (*fileUploadState, error) {
	if err := validateFileUploadMetadata(channel.ThreadID, channel.MimeType, channel.SizeBytes); err != nil {
		return nil, err
	}
	threadDirectoryPath := filepath.Join(attachmentRoot, channel.ThreadID)
	if err := os.MkdirAll(threadDirectoryPath, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create upload thread directory %s: %w", threadDirectoryPath, err)
	}

	attachmentID := fmt.Sprintf("%s_%d_%d", fileUploadAttachmentIDTag, clock.NowMS(), uploadIDCounter.Add(1))
	tempPath := filepath.Join(threadDirectoryPath, "."+attachmentID+".part")
	file, err := os.OpenFile(tempPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("failed to create temporary upload file %s: %w", tempPath, err)
	}
	return &fileUploadState{
		attachmentID:        attachmentID,
		threadDirectoryPath: threadDirectoryPath,
		threadID:            channel.ThreadID,
		mimeType:            channel.MimeType,
		originalFilename:    channel.OriginalFilename,
		sizeBytes:           channel.SizeBytes,
		tempPath:            tempPath,
		file:                file,
	}, nil
}

func (state *fileUploadState) Write(payload []byte) error {
	state.receivedBytes += uint64(len(payload))
	if state.receivedBytes > state.sizeBytes {
		state.Cleanup()
		return fileUploadResetError{
			code:    tunnelprotocol.FileUploadResetCodeByteCountExceeded,
			message: "received more bytes than declared by the upload metadata",
		}
	}
	if _, err := state.file.Write(payload); err != nil {
		return fmt.Errorf("failed to write upload bytes to %s: %w", state.tempPath, err)
	}
	return nil
}

func (state *fileUploadState) Finalize() (completedFileUpload, error) {
	if state.receivedBytes != state.sizeBytes {
		state.Cleanup()
		return completedFileUpload{}, fileUploadResetError{
			code:    tunnelprotocol.FileUploadResetCodeByteCountMismatch,
			message: "uploaded byte count did not match declared size",
		}
	}
	if err := state.file.Sync(); err != nil {
		return completedFileUpload{}, fmt.Errorf("failed to flush temporary upload file %s: %w", state.tempPath, err)
	}
	if err := state.file.Close(); err != nil {
		return completedFileUpload{}, fmt.Errorf("failed to close temporary upload file %s: %w", state.tempPath, err)
	}
	state.file = nil

	classification, err := ClassifyUploadedFile(state.mimeType, state.tempPath, state.originalFilename)
	if err != nil {
		state.Cleanup()
		var reset UploadClassificationResetError
		if errors.As(err, &reset) {
			return completedFileUpload{}, fileUploadResetError{code: reset.Code, message: reset.Message}
		}
		return completedFileUpload{}, fileUploadResetError{code: tunnelprotocol.FileUploadResetCodeInvalidFileType, message: err.Error()}
	}
	finalPath := filepath.Join(state.threadDirectoryPath, state.attachmentID+"."+classification.Extension)
	if err := os.Rename(state.tempPath, finalPath); err != nil {
		return completedFileUpload{}, fmt.Errorf("failed to persist uploaded file %s: %w", finalPath, err)
	}
	return completedFileUpload{
		kind:             classification.Kind,
		attachmentID:     state.attachmentID,
		threadID:         state.threadID,
		originalFilename: state.originalFilename,
		mimeType:         state.mimeType,
		sizeBytes:        state.sizeBytes,
		path:             finalPath,
	}, nil
}

func (state *fileUploadState) Cleanup() {
	if state.file != nil {
		_ = state.file.Close()
		state.file = nil
	}
	_ = os.Remove(state.tempPath)
}

type fileUploadResetError struct {
	code    string
	message string
}

func (err fileUploadResetError) Error() string {
	return err.message
}

func validateFileUploadMetadata(threadID string, mimeType string, sizeBytes uint64) error {
	if err := validateFileUploadThreadID(threadID); err != nil {
		return err
	}
	if strings.TrimSpace(mimeType) == "" {
		return fmt.Errorf("mimeType is required.")
	}
	if sizeBytes == 0 {
		return fmt.Errorf("sizeBytes must be greater than 0.")
	}
	if sizeBytes > maxUploadSizeBytes {
		return fmt.Errorf("sizeBytes exceeds the configured upload limit.")
	}
	return nil
}

func validateFileUploadThreadID(threadID string) error {
	trimmedThreadID := strings.TrimSpace(threadID)
	if trimmedThreadID == "" {
		return fmt.Errorf("threadId is required.")
	}
	if trimmedThreadID != threadID {
		return fmt.Errorf("threadId must not include leading or trailing whitespace.")
	}
	if len(threadID) > maxUploadThreadIDLength {
		return fmt.Errorf("threadId exceeds the configured length limit.")
	}
	for _, character := range threadID {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || character == '_' || character == '-' {
			continue
		}
		return fmt.Errorf("threadId must use only ASCII letters, digits, '_' or '-'.")
	}
	return nil
}
