package egressproxy

type TransparentProxyProtocol string

const (
	TransparentProxyProtocolEmpty       TransparentProxyProtocol = "empty"
	TransparentProxyProtocolPlainHTTP   TransparentProxyProtocol = "http"
	TransparentProxyProtocolTLS         TransparentProxyProtocol = "tls"
	TransparentProxyProtocolUnsupported TransparentProxyProtocol = "unsupported"
)

func ClassifyTransparentProxyFirstByte(firstByte byte) TransparentProxyProtocol {
	switch firstByte {
	case 0x16:
		return TransparentProxyProtocolTLS
	case 'A', 'C', 'D', 'G', 'H', 'O', 'P', 'T':
		return TransparentProxyProtocolPlainHTTP
	default:
		return TransparentProxyProtocolUnsupported
	}
}
