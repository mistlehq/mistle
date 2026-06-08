//go:build !linux

package egressproxy

import "fmt"

func discoverLocalDestinationIPv4CIDRs() ([]string, error) {
	return nil, fmt.Errorf("transparent proxy local destination route discovery requires Linux support")
}
