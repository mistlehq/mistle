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

func InstallProxyCACertificate(sourcePath string) error {
	if sourcePath == "" {
		return nil
	}
	if os.Geteuid() != 0 {
		return fmt.Errorf("proxy ca certificate installation requires root")
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
