package cgroups

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

const DefaultCgroupRoot = "/sys/fs/cgroup/mistle"
const linuxESRCH = 3

type SandboxPaths struct {
	SandboxRoot  string
	PlatformRoot string
	UserRoot     string
}

type ScopePaths struct {
	ScopeRoot  string
	ProcsFile  string
	EventsFile string
	KillFile   string
}

type CgroupErrorKind string

const (
	CgroupInvalidSandboxInstanceID CgroupErrorKind = "invalid_sandbox_instance_id"
	CgroupInvalidScopeID           CgroupErrorKind = "invalid_scope_id"
	CgroupCreateDirectoryError     CgroupErrorKind = "create_directory"
	CgroupWriteFileError           CgroupErrorKind = "write_file"
	CgroupReadFileError            CgroupErrorKind = "read_file"
	CgroupMissingPopulatedField    CgroupErrorKind = "missing_populated_field"
	CgroupInvalidPopulatedValue    CgroupErrorKind = "invalid_populated_value"
	CgroupInvalidProcessID         CgroupErrorKind = "invalid_process_id"
)

type CgroupError struct {
	Kind  CgroupErrorKind
	Path  string
	Value string
	Cause error
}

func (err *CgroupError) Error() string {
	switch err.Kind {
	case CgroupInvalidSandboxInstanceID:
		return "sandbox instance id must be a non-empty path segment"
	case CgroupInvalidScopeID:
		return "scope id must be a non-empty path segment"
	case CgroupCreateDirectoryError:
		return fmt.Sprintf("failed to create cgroup directory %s: %s", err.Path, err.Cause.Error())
	case CgroupWriteFileError:
		return fmt.Sprintf("failed to write cgroup file %s: %s", err.Path, err.Cause.Error())
	case CgroupReadFileError:
		return fmt.Sprintf("failed to read cgroup file %s: %s", err.Path, err.Cause.Error())
	case CgroupMissingPopulatedField:
		return fmt.Sprintf("cgroup.events at %s is missing populated", err.Path)
	case CgroupInvalidPopulatedValue:
		return fmt.Sprintf("cgroup.events at %s has invalid populated value %q", err.Path, err.Value)
	case CgroupInvalidProcessID:
		return fmt.Sprintf("cgroup.procs at %s has invalid pid %q", err.Path, err.Value)
	default:
		return "unsupported cgroup error"
	}
}

func (err *CgroupError) Unwrap() error {
	return err.Cause
}

func (err *CgroupError) IsMissingProcess() bool {
	if err == nil || err.Kind != CgroupWriteFileError {
		return false
	}
	var pathErr *os.PathError
	if errors.As(err.Cause, &pathErr) {
		return pathErr.Err == syscall.Errno(linuxESRCH)
	}
	return errors.Is(err.Cause, syscall.Errno(linuxESRCH))
}

func EnsureSandboxTree(cgroupRoot string, sandboxInstanceID string) (SandboxPaths, error) {
	if err := validateSegment(sandboxInstanceID, CgroupInvalidSandboxInstanceID); err != nil {
		return SandboxPaths{}, err
	}

	sandboxRoot := filepath.Join(cgroupRoot, sandboxInstanceID)
	platformRoot := filepath.Join(sandboxRoot, "platform")
	userRoot := filepath.Join(sandboxRoot, "user")

	if err := os.MkdirAll(platformRoot, 0o755); err != nil {
		return SandboxPaths{}, &CgroupError{Kind: CgroupCreateDirectoryError, Path: platformRoot, Cause: err}
	}
	if err := os.MkdirAll(userRoot, 0o755); err != nil {
		return SandboxPaths{}, &CgroupError{Kind: CgroupCreateDirectoryError, Path: userRoot, Cause: err}
	}

	return SandboxPaths{
		SandboxRoot:  sandboxRoot,
		PlatformRoot: platformRoot,
		UserRoot:     userRoot,
	}, nil
}

func CreateUserScope(cgroupRoot string, sandboxInstanceID string, scopeID string) (ScopePaths, error) {
	if err := validateSegment(scopeID, CgroupInvalidScopeID); err != nil {
		return ScopePaths{}, err
	}
	sandboxPaths, err := EnsureSandboxTree(cgroupRoot, sandboxInstanceID)
	if err != nil {
		return ScopePaths{}, err
	}
	return createScope(sandboxPaths.UserRoot, scopeID)
}

func CreatePlatformScope(cgroupRoot string, sandboxInstanceID string, scopeID string) (ScopePaths, error) {
	if err := validateSegment(scopeID, CgroupInvalidScopeID); err != nil {
		return ScopePaths{}, err
	}
	sandboxPaths, err := EnsureSandboxTree(cgroupRoot, sandboxInstanceID)
	if err != nil {
		return ScopePaths{}, err
	}
	return createScope(sandboxPaths.PlatformRoot, scopeID)
}

func KillSandboxUserScopes(cgroupRoot string, sandboxInstanceID string) error {
	return killSandboxScopes(cgroupRoot, sandboxInstanceID, "user")
}

func KillSandboxPlatformScopes(cgroupRoot string, sandboxInstanceID string) error {
	return killSandboxScopes(cgroupRoot, sandboxInstanceID, "platform")
}

func AttachPIDToScope(scopePaths ScopePaths, pid uint32) error {
	payload := fmt.Sprintf("%d\n", pid)
	if err := os.WriteFile(scopePaths.ProcsFile, []byte(payload), 0o644); err != nil {
		return &CgroupError{Kind: CgroupWriteFileError, Path: scopePaths.ProcsFile, Cause: err}
	}
	return nil
}

func ReadScopeProcessIDs(scopePaths ScopePaths) (map[uint32]struct{}, error) {
	content, err := os.ReadFile(scopePaths.ProcsFile)
	if err != nil {
		return nil, &CgroupError{Kind: CgroupReadFileError, Path: scopePaths.ProcsFile, Cause: err}
	}

	processIDs := map[uint32]struct{}{}
	for _, line := range strings.Split(string(content), "\n") {
		value := strings.TrimSpace(line)
		if value == "" {
			continue
		}
		processID, err := strconv.ParseUint(value, 10, 32)
		if err != nil {
			return nil, &CgroupError{
				Kind:  CgroupInvalidProcessID,
				Path:  scopePaths.ProcsFile,
				Value: value,
			}
		}
		processIDs[uint32(processID)] = struct{}{}
	}
	return processIDs, nil
}

func IsScopePopulated(scopePaths ScopePaths) (bool, error) {
	content, err := os.ReadFile(scopePaths.EventsFile)
	if err != nil {
		return false, &CgroupError{Kind: CgroupReadFileError, Path: scopePaths.EventsFile, Cause: err}
	}

	for _, line := range strings.Split(string(content), "\n") {
		key, value, found := strings.Cut(line, " ")
		if !found || key != "populated" {
			continue
		}
		switch strings.TrimSpace(value) {
		case "0":
			return false, nil
		case "1":
			return true, nil
		default:
			return false, &CgroupError{
				Kind:  CgroupInvalidPopulatedValue,
				Path:  scopePaths.EventsFile,
				Value: strings.TrimSpace(value),
			}
		}
	}

	return false, &CgroupError{Kind: CgroupMissingPopulatedField, Path: scopePaths.EventsFile}
}

func KillScope(scopePaths ScopePaths) error {
	if err := os.WriteFile(scopePaths.KillFile, []byte("1\n"), 0o644); err != nil {
		return &CgroupError{Kind: CgroupWriteFileError, Path: scopePaths.KillFile, Cause: err}
	}
	return nil
}

func createScope(scopeParent string, scopeID string) (ScopePaths, error) {
	scopeRoot := filepath.Join(scopeParent, scopeID)
	if err := os.MkdirAll(scopeRoot, 0o755); err != nil {
		return ScopePaths{}, &CgroupError{Kind: CgroupCreateDirectoryError, Path: scopeRoot, Cause: err}
	}
	return ScopePaths{
		ScopeRoot:  scopeRoot,
		ProcsFile:  filepath.Join(scopeRoot, "cgroup.procs"),
		EventsFile: filepath.Join(scopeRoot, "cgroup.events"),
		KillFile:   filepath.Join(scopeRoot, "cgroup.kill"),
	}, nil
}

func killSandboxScopes(cgroupRoot string, sandboxInstanceID string, scopeKind string) error {
	if err := validateSegment(sandboxInstanceID, CgroupInvalidSandboxInstanceID); err != nil {
		return err
	}
	scopesRoot := filepath.Join(cgroupRoot, sandboxInstanceID, scopeKind)
	entries, err := os.ReadDir(scopesRoot)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return &CgroupError{Kind: CgroupReadFileError, Path: scopesRoot, Cause: err}
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		scopeRoot := filepath.Join(scopesRoot, entry.Name())
		if err := KillScope(ScopePaths{
			ScopeRoot:  scopeRoot,
			ProcsFile:  filepath.Join(scopeRoot, "cgroup.procs"),
			EventsFile: filepath.Join(scopeRoot, "cgroup.events"),
			KillFile:   filepath.Join(scopeRoot, "cgroup.kill"),
		}); err != nil {
			return err
		}
	}
	return nil
}

func validateSegment(value string, errorKind CgroupErrorKind) error {
	if strings.TrimSpace(value) == "" ||
		strings.Contains(value, string(filepath.Separator)) ||
		strings.Contains(value, "/") ||
		value == "." ||
		value == ".." {
		return &CgroupError{Kind: errorKind}
	}
	return nil
}
