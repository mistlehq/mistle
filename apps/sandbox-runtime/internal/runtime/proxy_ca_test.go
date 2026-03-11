package runtime

import (
	"crypto/x509"
	"strconv"
	"testing"
	"time"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/bootstrap"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/config"
)

func TestLoadProxyCertificateAuthority(t *testing.T) {
	proxyCA, err := bootstrap.GenerateProxyCA(time.Date(2026, time.March, 11, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("expected proxy ca generation to succeed, got %v", err)
	}

	execEnv, cleanup, err := bootstrap.PrepareProxyCAExecEnv(proxyCA)
	if err != nil {
		t.Fatalf("expected proxy ca exec env preparation to succeed, got %v", err)
	}
	defer cleanup()

	certificateAuthority, err := loadProxyCertificateAuthority(config.Config{
		ProxyCAConfigured: true,
		ProxyCACertFD:     parseRuntimeFD(t, execEnv[config.ProxyCACertFDEnv]),
		ProxyCAKeyFD:      parseRuntimeFD(t, execEnv[config.ProxyCAKeyFDEnv]),
	})
	if err != nil {
		t.Fatalf("expected proxy ca load to succeed, got %v", err)
	}
	if certificateAuthority == nil {
		t.Fatal("expected proxy ca load to return a certificate authority")
	}

	issuedCertificate, err := certificateAuthority.IssueLeafCertificate("api.github.com")
	if err != nil {
		t.Fatalf("expected leaf certificate issuance to succeed, got %v", err)
	}
	if len(issuedCertificate.Certificate) == 0 {
		t.Fatal("expected issued certificate chain to be populated")
	}

	certificate, err := x509.ParseCertificate(issuedCertificate.Certificate[0])
	if err != nil {
		t.Fatalf("expected issued certificate parse to succeed, got %v", err)
	}
	if len(certificate.DNSNames) != 1 || certificate.DNSNames[0] != "api.github.com" {
		t.Fatalf("unexpected dns names on issued certificate: %#v", certificate.DNSNames)
	}
}

func parseRuntimeFD(t *testing.T, rawValue string) int {
	t.Helper()

	fd, err := strconv.Atoi(rawValue)
	if err != nil {
		t.Fatalf("expected fd value to parse, got %v", err)
	}
	return fd
}
