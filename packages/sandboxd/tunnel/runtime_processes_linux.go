//go:build linux

package tunnel

import (
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

func collectProcessEntries() ([]tunnelprotocol.ProcessEntry, error) {
	return collectProcessEntriesForProcRoot("/proc")
}

func collectProcessEntriesForProcRoot(procRoot string) ([]tunnelprotocol.ProcessEntry, error) {
	listenersByInode, err := readLocalBindListenersByInode(procRoot)
	if err != nil {
		return nil, err
	}
	pids, err := readNumericProcEntries(procRoot)
	if err != nil {
		return nil, err
	}
	processes := make([]tunnelprotocol.ProcessEntry, 0)
	for _, pid := range pids {
		listeners := readProcessListeners(procRoot, pid, listenersByInode)
		if len(listeners) == 0 {
			continue
		}
		processes = append(processes, tunnelprotocol.ProcessEntry{
			PID:       pid,
			Command:   readProcessCommand(procRoot, pid),
			Listeners: listeners,
		})
	}
	sort.Slice(processes, func(left int, right int) bool {
		return processes[left].PID < processes[right].PID
	})
	return processes, nil
}

func readNumericProcEntries(procRoot string) ([]uint32, error) {
	entries, err := os.ReadDir(procRoot)
	if err != nil {
		return nil, NewRuntimeProcessesError("failed to read /proc: " + err.Error())
	}
	pids := make([]uint32, 0)
	for _, entry := range entries {
		pid, err := strconv.ParseUint(entry.Name(), 10, 32)
		if err != nil {
			continue
		}
		pids = append(pids, uint32(pid))
	}
	return pids, nil
}

func readProcessCommand(procRoot string, pid uint32) *string {
	processRoot := filepath.Join(procRoot, strconv.FormatUint(uint64(pid), 10))
	cmdline, err := os.ReadFile(filepath.Join(processRoot, "cmdline"))
	if err == nil && len(cmdline) > 0 {
		segments := make([]string, 0)
		for _, segment := range strings.Split(string(cmdline), "\x00") {
			if segment != "" {
				segments = append(segments, segment)
			}
		}
		command := strings.Join(segments, " ")
		if command != "" {
			return &command
		}
	}
	comm, err := os.ReadFile(filepath.Join(processRoot, "comm"))
	if err != nil {
		return nil
	}
	command := strings.TrimSpace(string(comm))
	if command == "" {
		return nil
	}
	return &command
}

func readProcessListeners(
	procRoot string,
	pid uint32,
	listenersByInode map[uint64]tunnelprotocol.ProcessListener,
) []tunnelprotocol.ProcessListener {
	fdPath := filepath.Join(procRoot, strconv.FormatUint(uint64(pid), 10), "fd")
	entries, err := os.ReadDir(fdPath)
	if err != nil {
		return nil
	}
	listeners := make([]tunnelprotocol.ProcessListener, 0)
	seenInodes := map[uint64]struct{}{}
	for _, entry := range entries {
		target, err := os.Readlink(filepath.Join(fdPath, entry.Name()))
		if err != nil {
			continue
		}
		inode, ok := parseSocketInode(target)
		if !ok {
			continue
		}
		if _, exists := seenInodes[inode]; exists {
			continue
		}
		seenInodes[inode] = struct{}{}
		listener, ok := listenersByInode[inode]
		if !ok {
			continue
		}
		listeners = append(listeners, listener)
	}
	sort.Slice(listeners, func(left int, right int) bool {
		if listeners[left].Port != listeners[right].Port {
			return listeners[left].Port < listeners[right].Port
		}
		return listeners[left].BindAddress < listeners[right].BindAddress
	})
	return listeners
}

func parseSocketInode(target string) (uint64, bool) {
	trimmed := strings.TrimPrefix(target, "socket:[")
	if trimmed == target {
		return 0, false
	}
	trimmed = strings.TrimSuffix(trimmed, "]")
	inode, err := strconv.ParseUint(trimmed, 10, 64)
	return inode, err == nil
}

func readLocalBindListenersByInode(procRoot string) (map[uint64]tunnelprotocol.ProcessListener, error) {
	listeners := map[uint64]tunnelprotocol.ProcessListener{}
	for _, relativePath := range []string{"net/tcp", "net/tcp6"} {
		content, err := os.ReadFile(filepath.Join(procRoot, relativePath))
		if err != nil {
			continue
		}
		parsedListeners, err := parseProcNetListeners(string(content))
		if err != nil {
			return nil, err
		}
		for _, listener := range parsedListeners {
			listeners[listener.inode] = listener.listener
		}
	}
	return listeners, nil
}

func parseProcNetListeners(contents string) ([]listenerWithInode, error) {
	listeners := make([]listenerWithInode, 0)
	for _, line := range strings.Split(contents, "\n")[1:] {
		fields := strings.Fields(line)
		if len(fields) < 10 {
			continue
		}
		if fields[3] != "0A" {
			continue
		}
		listener, ok := parseLocalBindListener(fields[1])
		if !ok {
			continue
		}
		inode, err := strconv.ParseUint(fields[9], 10, 64)
		if err != nil {
			return nil, NewRuntimeProcessesError("invalid socket inode '" + fields[9] + "': " + err.Error())
		}
		listeners = append(listeners, listenerWithInode{inode: inode, listener: listener})
	}
	return listeners, nil
}

func parseLocalBindListener(socketAddress string) (tunnelprotocol.ProcessListener, bool) {
	addressHex, portHex, ok := strings.Cut(socketAddress, ":")
	if !ok {
		return tunnelprotocol.ProcessListener{}, false
	}
	port, err := strconv.ParseUint(portHex, 16, 16)
	if err != nil {
		return tunnelprotocol.ProcessListener{}, false
	}
	if len(addressHex) == 8 {
		bytes := make([]byte, 4)
		for index := 0; index < 4; index++ {
			value, err := strconv.ParseUint(addressHex[index*2:index*2+2], 16, 8)
			if err != nil {
				return tunnelprotocol.ProcessListener{}, false
			}
			bytes[index] = byte(value)
		}
		address := net.IPv4(bytes[3], bytes[2], bytes[1], bytes[0])
		if !address.IsLoopback() && !address.IsUnspecified() {
			return tunnelprotocol.ProcessListener{}, false
		}
		return tunnelprotocol.ProcessListener{
			Port:        uint16(port),
			BindAddress: address.String(),
		}, true
	}
	switch addressHex {
	case "00000000000000000000000000000000":
		return tunnelprotocol.ProcessListener{Port: uint16(port), BindAddress: "::"}, true
	case "00000000000000000000000000000001", "00000000000000000000000001000000":
		return tunnelprotocol.ProcessListener{Port: uint16(port), BindAddress: "::1"}, true
	default:
		return tunnelprotocol.ProcessListener{}, false
	}
}

type listenerWithInode struct {
	inode    uint64
	listener tunnelprotocol.ProcessListener
}
