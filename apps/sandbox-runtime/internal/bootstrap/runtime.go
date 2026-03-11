package bootstrap

import (
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"strconv"
	"strings"
	"syscall"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/config"
)

const SandboxdPath = "/usr/local/bin/sandboxd"
const UpdateCACertificatesPath = "/usr/sbin/update-ca-certificates"

func InstallProxyCACertificate(certificatePEM []byte) error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("proxy ca certificate reconciliation requires root")
	}
	if len(certificatePEM) == 0 {
		return fmt.Errorf("proxy ca certificate pem is required")
	}

	if err := os.WriteFile(ProxyCACertInstallPath, certificatePEM, 0o644); err != nil {
		return fmt.Errorf(
			"failed to write installed proxy ca certificate %s: %w",
			ProxyCACertInstallPath,
			err,
		)
	}

	return runUpdateCACertificates()
}

func runUpdateCACertificates() error {
	devNull, err := os.Open(os.DevNull)
	if err != nil {
		return fmt.Errorf("failed to open %s for update-ca-certificates stdin: %w", os.DevNull, err)
	}
	defer devNull.Close()

	command := exec.Command(UpdateCACertificatesPath)
	command.Stdin = devNull
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("failed to update ca certificates: %w", err)
	}
	return nil
}

func ExecSandboxdAsUser(sandboxUser string) error {
	return ExecSandboxdAsUserWithEnv(sandboxUser, nil)
}

func ExecSandboxdAsUserWithEnv(sandboxUser string, additionalEnv map[string]string) error {
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

	environment := append(filterBootstrapEnvironment(os.Environ()),
		"HOME="+resolvedUser.HomeDir,
		"LOGNAME="+resolvedUser.Username,
		"USER="+resolvedUser.Username,
	)
	for envName, envValue := range additionalEnv {
		environment = append(environment, envName+"="+envValue)
	}

	if err := syscall.Exec(SandboxdPath, []string{SandboxdPath}, environment); err != nil {
		return fmt.Errorf("failed to exec sandboxd: %w", err)
	}

	return nil
}

func filterBootstrapEnvironment(environment []string) []string {
	filteredEnvironment := make([]string, 0, len(environment))
	for _, entry := range environment {
		if strings.HasPrefix(entry, "HOME=") ||
			strings.HasPrefix(entry, "LOGNAME=") ||
			strings.HasPrefix(entry, "USER=") ||
			strings.HasPrefix(entry, config.ProxyCACertFDEnv+"=") ||
			strings.HasPrefix(entry, config.ProxyCAKeyFDEnv+"=") {
			continue
		}
		filteredEnvironment = append(filteredEnvironment, entry)
	}
	return filteredEnvironment
}
