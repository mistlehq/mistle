package egressproxy

import "testing"

func TestClassifiesTransparentProxyProtocolFromFirstByte(t *testing.T) {
	assertEqual(t, ClassifyTransparentProxyFirstByte(0x16), TransparentProxyProtocolTLS)
	assertEqual(t, ClassifyTransparentProxyFirstByte('G'), TransparentProxyProtocolPlainHTTP)
	assertEqual(t, ClassifyTransparentProxyFirstByte('P'), TransparentProxyProtocolPlainHTTP)
	assertEqual(t, ClassifyTransparentProxyFirstByte(0x00), TransparentProxyProtocolUnsupported)
}

func TestClassifiesHTTPMethodInitialBytesAsPlainHTTP(t *testing.T) {
	for _, firstByte := range []byte{'A', 'C', 'D', 'G', 'H', 'O', 'P', 'T'} {
		assertEqual(t, ClassifyTransparentProxyFirstByte(firstByte), TransparentProxyProtocolPlainHTTP)
	}
}
