package runtime

import (
	"fmt"

	"github.com/mistle/sandboxd/command"
)

type RuntimePlanApplyErrorKind string

const (
	RuntimePlanApplyArtifactInstallError RuntimePlanApplyErrorKind = "artifact_install"
	RuntimePlanApplyWorkspaceSourceError RuntimePlanApplyErrorKind = "workspace_source"
	RuntimePlanApplySkillsReconcileError RuntimePlanApplyErrorKind = "skills_reconcile"
	RuntimePlanApplyRuntimeFileError     RuntimePlanApplyErrorKind = "runtime_file"
)

type RuntimePlanApplyLifecycleStep string

const (
	RuntimePlanApplyLifecycleRuntimeArtifacts RuntimePlanApplyLifecycleStep = "runtime_artifacts"
	RuntimePlanApplyLifecycleWorkspaceSources RuntimePlanApplyLifecycleStep = "workspace_sources"
	RuntimePlanApplyLifecycleSkills           RuntimePlanApplyLifecycleStep = "skills"
	RuntimePlanApplyLifecycleRuntimeFiles     RuntimePlanApplyLifecycleStep = "runtime_files"
)

type RuntimePlanApplyObserver interface {
	RecordStepStarted(step RuntimePlanApplyLifecycleStep)
	RecordStepCompleted(step RuntimePlanApplyLifecycleStep)
}

type RuntimePlanApplyError struct {
	Kind          RuntimePlanApplyErrorKind
	ArtifactIndex int
	InstallIndex  int
	ArtifactKey   string
	InstallOp     RuntimeArtifactInstallOp
	SourceIndex   int
	SourceKind    WorkspaceSourceKind
	OriginURL     string
	CloneURL      *string
	RuntimeID     string
	RepoPath      *string
	ClientIndex   int
	ClientID      string
	FileIndex     int
	FileID        string
	Path          string
	Cause         error
}

func (err *RuntimePlanApplyError) Error() string {
	switch err.Kind {
	case RuntimePlanApplyArtifactInstallError:
		return fmt.Sprintf(
			"runtime plan artifacts[%d] lifecycle.install[%d] failed (artifactKey=%s op=%s): %s",
			err.ArtifactIndex,
			err.InstallIndex,
			err.ArtifactKey,
			err.InstallOp,
			err.Cause.Error(),
		)
	case RuntimePlanApplyWorkspaceSourceError:
		cloneURL := ""
		if err.CloneURL != nil {
			cloneURL = " cloneUrl=" + *err.CloneURL
		}
		return fmt.Sprintf(
			"runtime plan workspaceSources[%d] failed (sourceKind=%s path=%s originUrl=%s%s): %s",
			err.SourceIndex,
			err.SourceKind,
			err.Path,
			err.OriginURL,
			cloneURL,
			err.Cause.Error(),
		)
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
	case RuntimePlanApplySkillsReconcileError:
		repoPath := ""
		if err.RepoPath != nil {
			repoPath = " repoPath=" + *err.RepoPath
		}
		return fmt.Sprintf(
			"runtime plan skills reconciliation failed (originUrl=%s runtimeId=%s%s): %s",
			err.OriginURL,
			err.RuntimeID,
			repoPath,
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
	return ApplyCompiledRuntimePlanWithEnvironment(runtimePlan, nil)
}

func ApplyCompiledRuntimePlanWithEnvironment(runtimePlan CompiledRuntimePlan, managedEnv map[string]string) error {
	return ApplyCompiledRuntimePlanWithEnvironmentAndObserver(runtimePlan, managedEnv, nil)
}

func ApplyCompiledRuntimePlanWithEnvironmentAndObserver(
	runtimePlan CompiledRuntimePlan,
	managedEnv map[string]string,
	observer RuntimePlanApplyObserver,
) error {
	return ApplyCompiledRuntimePlanWithEnvironmentOutputSinkAndObserver(runtimePlan, managedEnv, nil, observer)
}

func ApplyCompiledRuntimePlanWithEnvironmentOutputSinkAndObserver(
	runtimePlan CompiledRuntimePlan,
	managedEnv map[string]string,
	outputSink command.OutputSink,
	observer RuntimePlanApplyObserver,
) error {
	if runtimePlanInstallsArtifacts(runtimePlan) && observer != nil {
		observer.RecordStepStarted(RuntimePlanApplyLifecycleRuntimeArtifacts)
	}
	for artifactIndex, artifact := range runtimePlan.Artifacts {
		for installIndex, installStep := range artifact.Lifecycle.Install {
			if err := ApplyArtifactInstallStepWithOutputSink(installStep, managedEnv, outputSink); err != nil {
				return &RuntimePlanApplyError{
					Kind:          RuntimePlanApplyArtifactInstallError,
					ArtifactIndex: artifactIndex,
					InstallIndex:  installIndex,
					ArtifactKey:   artifact.ArtifactKey,
					InstallOp:     installStep.Op,
					Cause:         err,
				}
			}
		}
	}
	if runtimePlanInstallsArtifacts(runtimePlan) && observer != nil {
		observer.RecordStepCompleted(RuntimePlanApplyLifecycleRuntimeArtifacts)
	}
	if len(runtimePlan.WorkspaceSources) > 0 && observer != nil {
		observer.RecordStepStarted(RuntimePlanApplyLifecycleWorkspaceSources)
	}
	for sourceIndex, workspaceSource := range runtimePlan.WorkspaceSources {
		if err := ApplyWorkspaceSourceWithOutputSink(workspaceSource, managedEnv, outputSink); err != nil {
			return &RuntimePlanApplyError{
				Kind:        RuntimePlanApplyWorkspaceSourceError,
				SourceIndex: sourceIndex,
				SourceKind:  workspaceSource.SourceKind,
				Path:        workspaceSource.Path,
				OriginURL:   workspaceSource.OriginURL,
				CloneURL:    workspaceSource.CloneURL,
				Cause:       err,
			}
		}
	}
	if len(runtimePlan.WorkspaceSources) > 0 && observer != nil {
		observer.RecordStepCompleted(RuntimePlanApplyLifecycleWorkspaceSources)
	}
	if runtimePlan.Skills != nil {
		if observer != nil {
			observer.RecordStepStarted(RuntimePlanApplyLifecycleSkills)
		}
		runtimeID := resolveRuntimePlanSkillsRuntimeID(runtimePlan)
		repoPath, err := resolveRuntimePlanSkillsRepoPath(runtimePlan, runtimePlan.Skills.OriginURL)
		if err != nil {
			return &RuntimePlanApplyError{
				Kind:      RuntimePlanApplySkillsReconcileError,
				OriginURL: runtimePlan.Skills.OriginURL,
				RuntimeID: runtimeID,
				Cause:     err,
			}
		}
		if err := applyRuntimePlanSkills(*runtimePlan.Skills, runtimeID, repoPath); err != nil {
			return &RuntimePlanApplyError{
				Kind:      RuntimePlanApplySkillsReconcileError,
				OriginURL: runtimePlan.Skills.OriginURL,
				RuntimeID: runtimeID,
				RepoPath:  &repoPath,
				Cause:     err,
			}
		}
		if observer != nil {
			observer.RecordStepCompleted(RuntimePlanApplyLifecycleSkills)
		}
	}
	if runtimePlanWritesRuntimeFiles(runtimePlan) && observer != nil {
		observer.RecordStepStarted(RuntimePlanApplyLifecycleRuntimeFiles)
	}
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
	if runtimePlanWritesRuntimeFiles(runtimePlan) && observer != nil {
		observer.RecordStepCompleted(RuntimePlanApplyLifecycleRuntimeFiles)
	}
	return nil
}

func runtimePlanInstallsArtifacts(runtimePlan CompiledRuntimePlan) bool {
	for _, artifact := range runtimePlan.Artifacts {
		if len(artifact.Lifecycle.Install) > 0 {
			return true
		}
	}
	return false
}

func runtimePlanWritesRuntimeFiles(runtimePlan CompiledRuntimePlan) bool {
	for _, runtimeClient := range runtimePlan.RuntimeClients {
		if len(runtimeClient.Setup.Files) > 0 {
			return true
		}
	}
	return false
}

func applyRuntimePlanSkills(skills CompiledRuntimePlanSkills, runtimeID string, repoPath string) error {
	return ReconcileRuntimePlanSkills(repoPath, runtimeID, skills.SelectedSkills)
}

func resolveRuntimePlanSkillsRuntimeID(runtimePlan CompiledRuntimePlan) string {
	if len(runtimePlan.AgentRuntimes) == 0 {
		return ""
	}
	return runtimePlan.AgentRuntimes[0].RuntimeID
}

func resolveRuntimePlanSkillsRepoPath(runtimePlan CompiledRuntimePlan, originURL string) (string, error) {
	matchingPaths := []string{}
	for _, workspaceSource := range runtimePlan.WorkspaceSources {
		if workspaceSource.OriginURL == originURL {
			matchingPaths = append(matchingPaths, workspaceSource.Path)
		}
	}
	if len(matchingPaths) == 0 {
		return "", fmt.Errorf("skills source '%s' was not found in runtime plan workspace sources", originURL)
	}
	if len(matchingPaths) > 1 {
		return "", fmt.Errorf("skills source '%s' matched multiple runtime plan workspace sources", originURL)
	}
	return matchingPaths[0], nil
}
