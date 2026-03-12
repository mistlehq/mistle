package bootstrap

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"time"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/config"
	"golang.org/x/sys/unix"
)

const proxyCACommonName = "Mistle Sandbox Proxy CA"
const proxyCAValidity = 24 * time.Hour

type GeneratedProxyCA struct {
	CertificatePEM []byte
	PrivateKeyPEM  []byte
}

func GenerateProxyCA(now time.Time) (GeneratedProxyCA, error) {
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return GeneratedProxyCA{}, fmt.Errorf("failed to generate proxy ca private key: %w", err)
	}

	serialNumber, err := randomSerialNumber()
	if err != nil {
		return GeneratedProxyCA{}, fmt.Errorf("failed to generate proxy ca serial number: %w", err)
	}

	notBefore := now.Add(-1 * time.Minute)
	notAfter := now.Add(proxyCAValidity)
	template := &x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			CommonName: proxyCACommonName,
		},
		NotBefore:             notBefore,
		NotAfter:              notAfter,
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign | x509.KeyUsageDigitalSignature,
	}

	certificateDER, err := x509.CreateCertificate(rand.Reader, template, template, privateKey.Public(), privateKey)
	if err != nil {
		return GeneratedProxyCA{}, fmt.Errorf("failed to generate proxy ca certificate: %w", err)
	}

	privateKeyDER, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return GeneratedProxyCA{}, fmt.Errorf("failed to encode proxy ca private key: %w", err)
	}

	return GeneratedProxyCA{
		CertificatePEM: pem.EncodeToMemory(&pem.Block{
			Type:  "CERTIFICATE",
			Bytes: certificateDER,
		}),
		PrivateKeyPEM: pem.EncodeToMemory(&pem.Block{
			Type:  "PRIVATE KEY",
			Bytes: privateKeyDER,
		}),
	}, nil
}

func prepareProxyCAFDPayload(name string, payload []byte) (*os.File, error) {
	readFile, writeFile, err := os.Pipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create %s pipe: %w", name, err)
	}

	closeWithErr := func(closeErr error) error {
		_ = readFile.Close()
		_ = writeFile.Close()
		return closeErr
	}

	if _, err := writeFile.Write(payload); err != nil {
		return nil, closeWithErr(fmt.Errorf("failed to write %s payload: %w", name, err))
	}
	if err := writeFile.Close(); err != nil {
		return nil, closeWithErr(fmt.Errorf("failed to close %s payload writer: %w", name, err))
	}

	fd := int(readFile.Fd())
	flags, err := unix.FcntlInt(uintptr(fd), unix.F_GETFD, 0)
	if err != nil {
		return nil, closeWithErr(fmt.Errorf("failed to read %s fd flags: %w", name, err))
	}
	if _, err := unix.FcntlInt(uintptr(fd), unix.F_SETFD, flags&^unix.FD_CLOEXEC); err != nil {
		return nil, closeWithErr(fmt.Errorf("failed to clear close-on-exec for %s fd: %w", name, err))
	}

	return readFile, nil
}

func PrepareProxyCAExecEnv(proxyCA GeneratedProxyCA) (map[string]string, func(), error) {
	certificateFile, err := prepareProxyCAFDPayload("proxy ca certificate", proxyCA.CertificatePEM)
	if err != nil {
		return nil, nil, err
	}

	privateKeyFile, err := prepareProxyCAFDPayload("proxy ca private key", proxyCA.PrivateKeyPEM)
	if err != nil {
		_ = certificateFile.Close()
		return nil, nil, err
	}

	cleanup := func() {
		_ = certificateFile.Close()
		_ = privateKeyFile.Close()
	}

	return map[string]string{
		config.ProxyCACertFDEnv: fmt.Sprintf("%d", certificateFile.Fd()),
		config.ProxyCAKeyFDEnv:  fmt.Sprintf("%d", privateKeyFile.Fd()),
	}, cleanup, nil
}

func randomSerialNumber() (*big.Int, error) {
	limit := new(big.Int).Lsh(big.NewInt(1), 128)
	return rand.Int(rand.Reader, limit)
}
