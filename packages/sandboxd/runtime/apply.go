package runtime

import "fmt"

type RuntimePlanApplyErrorKind string

const RuntimePlanApplyRuntimeFileError RuntimePlanApplyErrorKind = "runtime_file"

type RuntimePlanApplyError struct {
	Kind        RuntimePlanApplyErrorKind
	ClientIndex int
	ClientID    string
	FileIndex   int
	FileID      string
	Path        string
	Cause       error
}

func (err *RuntimePlanApplyError) Error() string {
	switch err.Kind {
	case RuntimePlanApplyRuntimeFileError:
		return fmt.Sprintf(
			"runtime plan runtimeClients[%d].setup.files[%d] failed (clientId=%s fileId=%s path=%s): %s",
			err.ClientIndex,
			err.FileIndex,
			err.ClientID,
			err.FileID,
			err.Path,
			err.Cause.Error(),
		)
	default:
		return err.Cause.Error()
	}
}

func (err *RuntimePlanApplyError) Unwrap() error {
	return err.Cause
}

func ApplyCompiledRuntimePlan(runtimePlan CompiledRuntimePlan) error {
	for clientIndex, runtimeClient := range runtimePlan.RuntimeClients {
		for fileIndex, file := range runtimeClient.Setup.Files {
			if _, err := ApplyRuntimeFile(file); err != nil {
				return &RuntimePlanApplyError{
					Kind:        RuntimePlanApplyRuntimeFileError,
					ClientIndex: clientIndex,
					ClientID:    runtimeClient.ClientID,
					FileIndex:   fileIndex,
					FileID:      file.FileID,
					Path:        file.Path,
					Cause:       err,
				}
			}
		}
	}
	return nil
}
