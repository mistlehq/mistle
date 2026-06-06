package egressproxy

const (
	SSL_CERT_FILE       = "SSL_CERT_FILE"
	CURL_CA_BUNDLE      = "CURL_CA_BUNDLE"
	GIT_SSL_CAINFO      = "GIT_SSL_CAINFO"
	REQUESTS_CA_BUNDLE  = "REQUESTS_CA_BUNDLE"
	NODE_EXTRA_CA_CERTS = "NODE_EXTRA_CA_CERTS"
	NIX_SSL_CERT_FILE   = "NIX_SSL_CERT_FILE"
	SSL_CERT_DIR        = "SSL_CERT_DIR"
	GIT_SSL_CAPATH      = "GIT_SSL_CAPATH"
)

var ManagedProxyEnvKeys = []string{
	SSL_CERT_FILE,
	CURL_CA_BUNDLE,
	GIT_SSL_CAINFO,
	REQUESTS_CA_BUNDLE,
	NODE_EXTRA_CA_CERTS,
	NIX_SSL_CERT_FILE,
	SSL_CERT_DIR,
	GIT_SSL_CAPATH,
}

func BuildManagedProxyEnv(caCertificatePath string) map[string]string {
	return map[string]string{
		SSL_CERT_FILE:       caCertificatePath,
		CURL_CA_BUNDLE:      caCertificatePath,
		GIT_SSL_CAINFO:      caCertificatePath,
		REQUESTS_CA_BUNDLE:  caCertificatePath,
		NODE_EXTRA_CA_CERTS: caCertificatePath,
		NIX_SSL_CERT_FILE:   caCertificatePath,
	}
}
