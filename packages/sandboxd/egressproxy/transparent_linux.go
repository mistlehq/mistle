//go:build linux

package egressproxy

import (
	"encoding/binary"
	"fmt"
	"net"
	"net/http"
	"syscall"
	"unsafe"
)

const transparentPassthroughSocketMark = 38514

func RecoverOriginalDestination(connection net.Conn) (net.Addr, error) {
	tcpConnection, ok := connection.(*net.TCPConn)
	if !ok {
		return nil, fmt.Errorf("transparent egress original destination lookup requires a TCP connection")
	}
	rawConnection, err := tcpConnection.SyscallConn()
	if err != nil {
		return nil, fmt.Errorf("failed to access transparent egress connection fd: %w", err)
	}
	var originalDestination net.Addr
	var controlErr error
	if err := rawConnection.Control(func(fd uintptr) {
		originalDestination, controlErr = recoverOriginalDestinationFromFD(int(fd), connection.LocalAddr())
	}); err != nil {
		return nil, fmt.Errorf("failed to inspect transparent egress connection fd: %w", err)
	}
	if controlErr != nil {
		return nil, controlErr
	}
	return originalDestination, nil
}

func DialTransparentPassthrough(originalDestination net.Addr) (net.Conn, error) {
	tcpAddress, ok := originalDestination.(*net.TCPAddr)
	if !ok {
		return nil, fmt.Errorf("transparent passthrough original destination must be a TCP address")
	}
	dialer := newTransparentPassthroughDialer()
	upstream, err := dialer.Dial("tcp", tcpAddress.String())
	if err != nil {
		return nil, fmt.Errorf("failed to connect transparent passthrough upstream %q: %w", tcpAddress.String(), err)
	}
	return upstream, nil
}

func NewTransparentPassthroughHTTPTransport() *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	dialer := newTransparentPassthroughDialer()
	transport.DialContext = dialer.DialContext
	return transport
}

func newTransparentPassthroughDialer() net.Dialer {
	return net.Dialer{
		Control: func(network string, address string, rawConnection syscall.RawConn) error {
			return markTransparentPassthroughSocket(rawConnection)
		},
	}
}

func markTransparentPassthroughSocket(rawConnection syscall.RawConn) error {
	var controlErr error
	if err := rawConnection.Control(func(fd uintptr) {
		controlErr = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_MARK, transparentPassthroughSocketMark)
	}); err != nil {
		return err
	}
	if controlErr != nil {
		return fmt.Errorf("failed to mark transparent passthrough upstream socket: %w", controlErr)
	}
	return nil
}

func recoverOriginalDestinationFromFD(fd int, localAddress net.Addr) (net.Addr, error) {
	socketLevel := syscall.SOL_IP
	socketOption := 80
	if tcpAddress, ok := localAddress.(*net.TCPAddr); ok && tcpAddress.IP.To4() == nil {
		socketLevel = syscall.IPPROTO_IPV6
		socketOption = 80
	}
	var rawAddress syscall.RawSockaddrAny
	rawAddressLength := uint32(unsafe.Sizeof(rawAddress))
	_, _, errno := syscall.Syscall6(
		syscall.SYS_GETSOCKOPT,
		uintptr(fd),
		uintptr(socketLevel),
		uintptr(socketOption),
		uintptr(unsafe.Pointer(&rawAddress)),
		uintptr(unsafe.Pointer(&rawAddressLength)),
		0,
	)
	if errno != 0 {
		return nil, fmt.Errorf("failed to recover transparent egress original destination: %w", errno)
	}
	return socketAddressFromRawSockaddrAny(&rawAddress, rawAddressLength)
}

func socketAddressFromRawSockaddrAny(rawAddress *syscall.RawSockaddrAny, rawAddressLength uint32) (net.Addr, error) {
	switch rawAddress.Addr.Family {
	case syscall.AF_INET:
		if rawAddressLength < uint32(unsafe.Sizeof(syscall.RawSockaddrInet4{})) {
			return nil, fmt.Errorf("SO_ORIGINAL_DST returned a truncated IPv4 socket address")
		}
		rawIPv4 := (*syscall.RawSockaddrInet4)(unsafe.Pointer(rawAddress))
		return &net.TCPAddr{
			IP:   net.IPv4(rawIPv4.Addr[0], rawIPv4.Addr[1], rawIPv4.Addr[2], rawIPv4.Addr[3]),
			Port: int(binary.BigEndian.Uint16((*[2]byte)(unsafe.Pointer(&rawIPv4.Port))[:])),
		}, nil
	case syscall.AF_INET6:
		if rawAddressLength < uint32(unsafe.Sizeof(syscall.RawSockaddrInet6{})) {
			return nil, fmt.Errorf("SO_ORIGINAL_DST returned a truncated IPv6 socket address")
		}
		rawIPv6 := (*syscall.RawSockaddrInet6)(unsafe.Pointer(rawAddress))
		return &net.TCPAddr{
			IP:   net.IP(rawIPv6.Addr[:]),
			Port: int(binary.BigEndian.Uint16((*[2]byte)(unsafe.Pointer(&rawIPv6.Port))[:])),
			Zone: zoneFromScopeID(rawIPv6.Scope_id),
		}, nil
	default:
		return nil, fmt.Errorf("SO_ORIGINAL_DST returned unsupported socket family %d", rawAddress.Addr.Family)
	}
}

func zoneFromScopeID(scopeID uint32) string {
	if scopeID == 0 {
		return ""
	}
	interfaceByIndex, err := net.InterfaceByIndex(int(scopeID))
	if err != nil {
		return fmt.Sprint(scopeID)
	}
	return interfaceByIndex.Name
}
