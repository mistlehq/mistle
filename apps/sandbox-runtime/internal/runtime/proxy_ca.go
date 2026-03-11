package runtime

import (
	"fmt"
	"io"
	"os"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/config"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/proxy"
)

func loadProxyCertificateAuthority(cfg config.Config) (*proxy.CertificateAuthority, error) {
	if !cfg.ProxyCAConfigured {
		return nil, nil
	}

	certificatePEM, err := readInheritedFD(cfg.ProxyCACertFD, config.ProxyCACertFDEnv)
	if err != nil {
		return nil, err
	}
	privateKeyPEM, err := readInheritedFD(cfg.ProxyCAKeyFD, config.ProxyCAKeyFDEnv)
	if err != nil {
		return nil, err
	}

	certificateAuthority, err := proxy.NewCertificateAuthority(certificatePEM, privateKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("failed to load proxy certificate authority: %w", err)
	}

	return certificateAuthority, nil
}

func readInheritedFD(fd int, envName string) ([]byte, error) {
	file := os.NewFile(uintptr(fd), envName)
	if file == nil {
		return nil, fmt.Errorf("%s refers to an invalid file descriptor", envName)
	}
	defer file.Close()

	payload, err := io.ReadAll(file)
	if err != nil {
		return nil, fmt.Errorf("failed to read %s payload: %w", envName, err)
	}
	if len(payload) == 0 {
		return nil, fmt.Errorf("%s payload must not be empty", envName)
	}

	return payload, nil
}
