package bootstrap

import (
	"crypto/x509"
	"encoding/pem"
	"io"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/config"
)

func TestGenerateProxyCA(t *testing.T) {
	proxyCA, err := GenerateProxyCA(time.Date(2026, time.March, 11, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("expected proxy ca generation to succeed, got %v", err)
	}

	certificateBlock, _ := pem.Decode(proxyCA.CertificatePEM)
	if certificateBlock == nil {
		t.Fatal("expected certificate pem block to decode")
	}
	certificate, err := x509.ParseCertificate(certificateBlock.Bytes)
	if err != nil {
		t.Fatalf("expected certificate parse to succeed, got %v", err)
	}
	if !certificate.IsCA {
		t.Fatal("expected generated certificate to be a ca")
	}

	privateKeyBlock, _ := pem.Decode(proxyCA.PrivateKeyPEM)
	if privateKeyBlock == nil {
		t.Fatal("expected private key pem block to decode")
	}
	if _, err := x509.ParsePKCS8PrivateKey(privateKeyBlock.Bytes); err != nil {
		t.Fatalf("expected private key parse to succeed, got %v", err)
	}
}

func TestPrepareProxyCAExecEnv(t *testing.T) {
	proxyCA, err := GenerateProxyCA(time.Date(2026, time.March, 11, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("expected proxy ca generation to succeed, got %v", err)
	}

	environment, cleanup, err := PrepareProxyCAExecEnv(proxyCA)
	if err != nil {
		t.Fatalf("expected proxy ca exec env preparation to succeed, got %v", err)
	}
	defer cleanup()

	certificateFile := os.NewFile(parseFD(t, environment[config.ProxyCACertFDEnv]), "proxy-ca-cert")
	if certificateFile == nil {
		t.Fatal("expected proxy ca cert fd to resolve to a file")
	}
	defer certificateFile.Close()
	certificateBytes := readAll(t, certificateFile)
	if string(certificateBytes) != string(proxyCA.CertificatePEM) {
		t.Fatal("expected certificate fd payload to match generated certificate pem")
	}

	privateKeyFile := os.NewFile(parseFD(t, environment[config.ProxyCAKeyFDEnv]), "proxy-ca-key")
	if privateKeyFile == nil {
		t.Fatal("expected proxy ca key fd to resolve to a file")
	}
	defer privateKeyFile.Close()
	privateKeyBytes := readAll(t, privateKeyFile)
	if string(privateKeyBytes) != string(proxyCA.PrivateKeyPEM) {
		t.Fatal("expected private key fd payload to match generated private key pem")
	}
}

func parseFD(t *testing.T, rawValue string) uintptr {
	t.Helper()

	fd, err := strconv.Atoi(rawValue)
	if err != nil {
		t.Fatalf("expected fd env value to parse, got %v", err)
	}
	return uintptr(fd)
}

func readAll(t *testing.T, file *os.File) []byte {
	t.Helper()

	payload, err := io.ReadAll(file)
	if err != nil {
		t.Fatalf("expected fd payload read to succeed, got %v", err)
	}
	return payload
}
