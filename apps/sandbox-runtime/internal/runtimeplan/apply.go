package runtimeplan

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

type ApplyInput struct {
	RuntimePlan startup.RuntimePlan
}

func Apply(input ApplyInput) error {
	for setupIndex, setup := range input.RuntimePlan.RuntimeClientSetups {
		for fileIndex, file := range setup.Files {
			if err := applyRuntimeFile(file); err != nil {
				return fmt.Errorf(
					"runtime plan runtimeClientSetups[%d] files[%d] failed (clientId=%s fileId=%s path=%s): %w",
					setupIndex,
					fileIndex,
					setup.ClientID,
					file.FileID,
					file.Path,
					err,
				)
			}
		}
	}

	return nil
}

func applyRuntimeFile(file startup.RuntimeFileSpec) error {
	parentDirectory := filepath.Dir(file.Path)
	if err := os.MkdirAll(parentDirectory, 0o755); err != nil {
		return fmt.Errorf("failed to create parent directory %s: %w", parentDirectory, err)
	}

	if err := os.WriteFile(file.Path, []byte(file.Content), os.FileMode(file.Mode)); err != nil {
		return fmt.Errorf("failed to write file %s: %w", file.Path, err)
	}

	return nil
}
