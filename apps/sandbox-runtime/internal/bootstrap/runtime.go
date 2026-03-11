package bootstrap

import (
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"strconv"
	"syscall"
)

const SandboxdPath = "/usr/local/bin/sandboxd"
const UpdateCACertificatesPath = "/usr/sbin/update-ca-certificates"

type ProxyCACertificateAction string

const (
	ProxyCACertificateActionNoop    ProxyCACertificateAction = "noop"
	ProxyCACertificateActionInstall ProxyCACertificateAction = "install"
	ProxyCACertificateActionRemove  ProxyCACertificateAction = "remove"
)

func resolveProxyCACertificateAction(sourcePath string, installedCertificateExists bool) ProxyCACertificateAction {
	if sourcePath != "" {
		return ProxyCACertificateActionInstall
	}
	if installedCertificateExists {
		return ProxyCACertificateActionRemove
	}
	return ProxyCACertificateActionNoop
}

func InstallProxyCACertificate(sourcePath string) error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("proxy ca certificate reconciliation requires root")
	}

	_, statErr := os.Stat(ProxyCACertInstallPath)
	installedCertificateExists := statErr == nil
	if statErr != nil && !os.IsNotExist(statErr) {
		return fmt.Errorf("failed to stat installed proxy ca certificate %s: %w", ProxyCACertInstallPath, statErr)
	}

	switch resolveProxyCACertificateAction(sourcePath, installedCertificateExists) {
	case ProxyCACertificateActionNoop:
		return nil
	case ProxyCACertificateActionRemove:
		if err := os.Remove(ProxyCACertInstallPath); err != nil {
			return fmt.Errorf(
				"failed to remove installed proxy ca certificate %s: %w",
				ProxyCACertInstallPath,
				err,
			)
		}
		return runUpdateCACertificates()
	case ProxyCACertificateActionInstall:
	default:
		return fmt.Errorf("unexpected proxy ca certificate action")
	}

	certificateBytes, err := os.ReadFile(sourcePath)
	if err != nil {
		return fmt.Errorf("failed to read proxy ca certificate %s: %w", sourcePath, err)
	}

	if err := os.WriteFile(ProxyCACertInstallPath, certificateBytes, 0o644); err != nil {
		return fmt.Errorf(
			"failed to write installed proxy ca certificate %s: %w",
			ProxyCACertInstallPath,
			err,
		)
	}

	return runUpdateCACertificates()
}

func runUpdateCACertificates() error {
	command := exec.Command(UpdateCACertificatesPath)
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("failed to update ca certificates: %w", err)
	}
	return nil
}

func ExecSandboxdAsUser(sandboxUser string) error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("sandbox bootstrap must start as root")
	}

	resolvedUser, err := user.Lookup(sandboxUser)
	if err != nil {
		return fmt.Errorf("failed to resolve sandbox user %q: %w", sandboxUser, err)
	}

	uid, err := strconv.Atoi(resolvedUser.Uid)
	if err != nil {
		return fmt.Errorf("failed to parse sandbox uid %q: %w", resolvedUser.Uid, err)
	}
	if uid == 0 {
		return fmt.Errorf("sandbox user %q must not resolve to uid 0", sandboxUser)
	}
	gid, err := strconv.Atoi(resolvedUser.Gid)
	if err != nil {
		return fmt.Errorf("failed to parse sandbox gid %q: %w", resolvedUser.Gid, err)
	}

	if err := syscall.Setgroups([]int{gid}); err != nil {
		return fmt.Errorf("failed to set supplementary groups: %w", err)
	}
	if err := syscall.Setgid(gid); err != nil {
		return fmt.Errorf("failed to drop group privileges: %w", err)
	}
	if err := syscall.Setuid(uid); err != nil {
		return fmt.Errorf("failed to drop user privileges: %w", err)
	}

	environment := append(os.Environ(),
		"HOME="+resolvedUser.HomeDir,
		"LOGNAME="+resolvedUser.Username,
		"USER="+resolvedUser.Username,
	)

	if err := syscall.Exec(SandboxdPath, []string{SandboxdPath}, environment); err != nil {
		return fmt.Errorf("failed to exec sandboxd: %w", err)
	}

	return nil
}
