package egressproxy

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"strings"
	"time"
)

const proxyCACommonName = "Mistle Sandbox Proxy CA"

var (
	proxyCAValidity   = 10 * 365 * 24 * time.Hour
	proxyLeafValidity = 12 * time.Hour
	certificateSkew   = time.Minute
)

type GeneratedProxyCA struct {
	CertificatePEM string
	PrivateKeyPEM  string
}

func GenerateProxyCA(now time.Time) (GeneratedProxyCA, error) {
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return GeneratedProxyCA{}, fmt.Errorf("failed to generate proxy ca private key: %w", err)
	}
	template, err := proxyCACertificateTemplate(now)
	if err != nil {
		return GeneratedProxyCA{}, err
	}
	certificateDER, err := x509.CreateCertificate(rand.Reader, template, template, &privateKey.PublicKey, privateKey)
	if err != nil {
		return GeneratedProxyCA{}, fmt.Errorf("failed to generate proxy ca certificate: %w", err)
	}
	privateKeyDER, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return GeneratedProxyCA{}, fmt.Errorf("failed to encode proxy ca private key: %w", err)
	}
	return GeneratedProxyCA{
		CertificatePEM: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificateDER})),
		PrivateKeyPEM:  string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateKeyDER})),
	}, nil
}

func IssueProxyLeafCertificate(caCertificatePEM string, caPrivateKeyPEM string, serverName string, now time.Time) (tlsCertificatePEM string, tlsPrivateKeyPEM string, err error) {
	normalizedServerName := normalizeCertificateHost(serverName)
	if normalizedServerName == "" {
		return "", "", fmt.Errorf("server name is required")
	}
	caCertificate, err := parseCertificatePEM(caCertificatePEM, "proxy ca certificate")
	if err != nil {
		return "", "", err
	}
	caPrivateKey, err := parsePrivateKeyPEM(caPrivateKeyPEM, "proxy ca private key")
	if err != nil {
		return "", "", err
	}
	signer, ok := caPrivateKey.(crypto.Signer)
	if !ok {
		return "", "", fmt.Errorf("proxy ca private key does not support signing")
	}

	leafPrivateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", fmt.Errorf("failed to generate leaf private key for %q: %w", normalizedServerName, err)
	}
	template, err := proxyLeafCertificateTemplate(normalizedServerName, now)
	if err != nil {
		return "", "", err
	}
	certificateDER, err := x509.CreateCertificate(rand.Reader, template, caCertificate, &leafPrivateKey.PublicKey, signer)
	if err != nil {
		return "", "", fmt.Errorf("failed to issue leaf certificate for %q: %w", normalizedServerName, err)
	}
	privateKeyDER, err := x509.MarshalPKCS8PrivateKey(leafPrivateKey)
	if err != nil {
		return "", "", fmt.Errorf("failed to encode leaf private key for %q: %w", normalizedServerName, err)
	}
	certificatePEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificateDER})) + caCertificatePEM
	privateKeyPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateKeyDER}))
	return certificatePEM, privateKeyPEM, nil
}

func proxyCACertificateTemplate(now time.Time) (*x509.Certificate, error) {
	serialNumber, err := randomSerialNumber()
	if err != nil {
		return nil, err
	}
	return &x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			CommonName: proxyCACommonName,
		},
		NotBefore:             now.Add(-certificateSkew),
		NotAfter:              now.Add(proxyCAValidity),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}, nil
}

func proxyLeafCertificateTemplate(serverName string, now time.Time) (*x509.Certificate, error) {
	serialNumber, err := randomSerialNumber()
	if err != nil {
		return nil, err
	}
	template := &x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			CommonName: serverName,
		},
		NotBefore:   now.Add(-certificateSkew),
		NotAfter:    now.Add(proxyLeafValidity),
		KeyUsage:    x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	if ipAddress := net.ParseIP(serverName); ipAddress != nil {
		template.IPAddresses = []net.IP{ipAddress}
	} else {
		template.DNSNames = []string{serverName}
	}
	return template, nil
}

func randomSerialNumber() (*big.Int, error) {
	serialLimit := new(big.Int).Lsh(big.NewInt(1), 128)
	serialNumber, err := rand.Int(rand.Reader, serialLimit)
	if err != nil {
		return nil, fmt.Errorf("failed to generate certificate serial number: %w", err)
	}
	return serialNumber, nil
}

func parseCertificatePEM(payload string, name string) (*x509.Certificate, error) {
	block, _ := pem.Decode([]byte(payload))
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, fmt.Errorf("%s pem is invalid", name)
	}
	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse %s: %w", name, err)
	}
	return certificate, nil
}

func parsePrivateKeyPEM(payload string, name string) (any, error) {
	block, _ := pem.Decode([]byte(payload))
	if block == nil {
		return nil, fmt.Errorf("%s pem is invalid", name)
	}
	if privateKey, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		return privateKey, nil
	}
	if privateKey, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
		return privateKey, nil
	}
	if privateKey, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return privateKey, nil
	}
	return nil, fmt.Errorf("failed to parse %s", name)
}

func normalizeCertificateHost(serverName string) string {
	trimmedServerName := strings.ToLower(strings.TrimSpace(serverName))
	if trimmedServerName == "" {
		return ""
	}
	if strings.HasPrefix(trimmedServerName, "[") {
		if endBracketIndex := strings.Index(trimmedServerName, "]"); endBracketIndex > 0 {
			return trimmedServerName[1:endBracketIndex]
		}
	}
	if strings.Count(trimmedServerName, ":") == 1 {
		host, port, found := strings.Cut(trimmedServerName, ":")
		if found && host != "" && port != "" {
			if _, err := net.LookupPort("tcp", port); err == nil {
				return host
			}
		}
	}
	return trimmedServerName
}

var _ crypto.Signer = (*rsa.PrivateKey)(nil)
var _ crypto.Signer = (*ecdsa.PrivateKey)(nil)
