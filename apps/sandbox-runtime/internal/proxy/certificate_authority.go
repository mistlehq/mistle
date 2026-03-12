package proxy

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"strings"
	"sync"
	"time"
)

const issuedLeafValidity = 12 * time.Hour

type CertificateAuthority struct {
	certificate *x509.Certificate
	signer      crypto.Signer
	cache       map[string]*tls.Certificate
	mutex       sync.Mutex
}

func NewCertificateAuthority(certificatePEM []byte, privateKeyPEM []byte) (*CertificateAuthority, error) {
	certificate, err := parseCertificatePEM(certificatePEM)
	if err != nil {
		return nil, err
	}
	signer, err := parsePrivateKeyPEM(privateKeyPEM)
	if err != nil {
		return nil, err
	}

	return &CertificateAuthority{
		certificate: certificate,
		signer:      signer,
		cache:       map[string]*tls.Certificate{},
	}, nil
}

func (certificateAuthority *CertificateAuthority) TLSConfig(connectTarget string) *tls.Config {
	return &tls.Config{
		MinVersion: tls.VersionTLS12,
		GetCertificate: func(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
			serverName := strings.TrimSpace(hello.ServerName)
			if serverName == "" {
				serverName = connectTarget
			}

			return certificateAuthority.IssueLeafCertificate(serverName)
		},
	}
}

func (certificateAuthority *CertificateAuthority) IssueLeafCertificate(serverName string) (*tls.Certificate, error) {
	cacheKey := normalizeCertificateHost(serverName)

	certificateAuthority.mutex.Lock()
	defer certificateAuthority.mutex.Unlock()

	cachedCertificate, ok := certificateAuthority.cache[cacheKey]
	if ok {
		return cachedCertificate, nil
	}

	leafCertificate, err := certificateAuthority.issueLeafCertificateLocked(cacheKey)
	if err != nil {
		return nil, err
	}

	certificateAuthority.cache[cacheKey] = leafCertificate
	return leafCertificate, nil
}

func (certificateAuthority *CertificateAuthority) issueLeafCertificateLocked(serverName string) (*tls.Certificate, error) {
	leafPrivateKey, err := generateLeafPrivateKey()
	if err != nil {
		return nil, err
	}

	serialNumber, err := randomProxySerialNumber()
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	template := &x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			CommonName: serverName,
		},
		NotBefore: now.Add(-1 * time.Minute),
		NotAfter:  minTime(certificateAuthority.certificate.NotAfter, now.Add(issuedLeafValidity)),
		KeyUsage:  x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage: []x509.ExtKeyUsage{
			x509.ExtKeyUsageServerAuth,
		},
		BasicConstraintsValid: true,
	}

	if ipAddress := net.ParseIP(serverName); ipAddress != nil {
		template.IPAddresses = []net.IP{ipAddress}
	} else {
		template.DNSNames = []string{serverName}
	}

	leafDER, err := x509.CreateCertificate(rand.Reader, template, certificateAuthority.certificate, leafPrivateKey.Public(), certificateAuthority.signer)
	if err != nil {
		return nil, fmt.Errorf("failed to issue leaf certificate for %q: %w", serverName, err)
	}

	leafCertificate := &tls.Certificate{
		Certificate: [][]byte{leafDER, certificateAuthority.certificate.Raw},
		PrivateKey:  leafPrivateKey,
	}
	leafCertificate.Leaf, err = x509.ParseCertificate(leafDER)
	if err != nil {
		return nil, fmt.Errorf("failed to parse issued leaf certificate for %q: %w", serverName, err)
	}

	return leafCertificate, nil
}

func generateLeafPrivateKey() (*ecdsa.PrivateKey, error) {
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate leaf private key: %w", err)
	}
	return privateKey, nil
}

func parseCertificatePEM(certificatePEM []byte) (*x509.Certificate, error) {
	block, _ := pem.Decode(certificatePEM)
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, fmt.Errorf("proxy ca certificate pem is invalid")
	}

	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse proxy ca certificate: %w", err)
	}

	return certificate, nil
}

func parsePrivateKeyPEM(privateKeyPEM []byte) (crypto.Signer, error) {
	block, _ := pem.Decode(privateKeyPEM)
	if block == nil {
		return nil, fmt.Errorf("proxy ca private key pem is invalid")
	}

	privateKey, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse proxy ca private key: %w", err)
	}

	signer, ok := privateKey.(crypto.Signer)
	if !ok {
		return nil, fmt.Errorf("proxy ca private key is not a signer")
	}

	return signer, nil
}

func normalizeCertificateHost(serverName string) string {
	host, _, err := net.SplitHostPort(serverName)
	if err == nil {
		return strings.ToLower(host)
	}
	return strings.ToLower(strings.TrimSpace(serverName))
}

func randomProxySerialNumber() (*big.Int, error) {
	limit := new(big.Int).Lsh(big.NewInt(1), 128)
	return rand.Int(rand.Reader, limit)
}

func minTime(left time.Time, right time.Time) time.Time {
	if left.Before(right) {
		return left
	}
	return right
}
