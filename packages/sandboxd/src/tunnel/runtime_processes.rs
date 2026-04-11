//! Process and local-bind listener inventory for the `processes` stream.
//!
//! This module keeps the phase-1 inventory feed objective: enumerate the
//! running processes visible to `sandboxd`, retain only those with local-bind
//! TCP listeners, and serialize one snapshot timestamp for the whole observation.

use std::fmt::{self, Display};
use std::path::Path;
#[cfg(target_os = "linux")]
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    net::Ipv4Addr,
};

use crate::time::{Clock, format_rfc3339_timestamp};
#[cfg(target_os = "linux")]
use crate::tunnel::protocol::ProcessListener;
use crate::tunnel::protocol::{ProcessEntry, ProcessesSnapshot};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeProcessesError {
    message: String,
}

impl RuntimeProcessesError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for RuntimeProcessesError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for RuntimeProcessesError {}

pub fn collect_processes_snapshot(
    clock: &dyn Clock,
) -> Result<ProcessesSnapshot, RuntimeProcessesError> {
    let processes = collect_process_entries()?;
    let observed_at = format_rfc3339_timestamp(clock.now_system_time())
        .map_err(|error| RuntimeProcessesError::new(error.to_string()))?;

    Ok(ProcessesSnapshot {
        message_type: "processes.snapshot".to_string(),
        observed_at,
        processes,
    })
}

fn collect_process_entries() -> Result<Vec<ProcessEntry>, RuntimeProcessesError> {
    collect_process_entries_for_proc_root(Path::new("/proc"))
}

fn collect_process_entries_for_proc_root(
    proc_root: &Path,
) -> Result<Vec<ProcessEntry>, RuntimeProcessesError> {
    #[cfg(target_os = "linux")]
    {
        collect_linux_process_entries(proc_root)
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = proc_root;
        Err(RuntimeProcessesError::new(
            "sandboxd processes inventory is only supported in linux sandboxes",
        ))
    }
}

#[cfg(target_os = "linux")]
fn collect_linux_process_entries(
    proc_root: &Path,
) -> Result<Vec<ProcessEntry>, RuntimeProcessesError> {
    let listeners_by_inode = read_local_bind_listeners_by_inode(proc_root)?;
    let mut processes = Vec::new();

    for pid in read_numeric_proc_entries(proc_root)? {
        let command = read_process_command(proc_root, pid);
        let listeners = read_process_listeners(proc_root, pid, &listeners_by_inode);
        if listeners.is_empty() {
            continue;
        }
        processes.push(ProcessEntry {
            pid,
            command,
            listeners,
        });
    }

    processes.sort_by_key(|process| process.pid);
    Ok(processes)
}

#[cfg(target_os = "linux")]
fn read_numeric_proc_entries(proc_root: &Path) -> Result<Vec<u32>, RuntimeProcessesError> {
    let entries = fs::read_dir(proc_root)
        .map_err(|error| RuntimeProcessesError::new(format!("failed to read /proc: {error}")))?;
    let mut pids = Vec::new();

    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        let Ok(pid) = file_name.parse::<u32>() else {
            continue;
        };
        pids.push(pid);
    }

    Ok(pids)
}

#[cfg(target_os = "linux")]
fn read_process_command(proc_root: &Path, pid: u32) -> Option<String> {
    let cmdline_path = proc_root.join(pid.to_string()).join("cmdline");
    let cmdline_bytes = fs::read(cmdline_path).ok()?;
    if !cmdline_bytes.is_empty() {
        let command = cmdline_bytes
            .split(|byte| *byte == 0)
            .filter_map(|segment| std::str::from_utf8(segment).ok())
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        if !command.is_empty() {
            return Some(command);
        }
    }

    let comm_path = proc_root.join(pid.to_string()).join("comm");
    let command = fs::read_to_string(comm_path).ok()?;
    let command = command.trim().to_string();
    if command.is_empty() {
        None
    } else {
        Some(command)
    }
}

#[cfg(target_os = "linux")]
fn read_process_listeners(
    proc_root: &Path,
    pid: u32,
    listeners_by_inode: &BTreeMap<u64, ProcessListener>,
) -> Vec<ProcessListener> {
    let fd_path = proc_root.join(pid.to_string()).join("fd");
    let Ok(entries) = fs::read_dir(fd_path) else {
        return Vec::new();
    };
    let mut listeners = Vec::new();
    let mut seen_inodes = BTreeSet::new();

    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        let Ok(target) = fs::read_link(entry.path()) else {
            continue;
        };
        let Some(inode) = parse_socket_inode(target.as_path()) else {
            continue;
        };
        if !seen_inodes.insert(inode) {
            continue;
        }
        let Some(listener) = listeners_by_inode.get(&inode) else {
            continue;
        };
        listeners.push(listener.clone());
    }

    listeners.sort_by(|left, right| {
        left.port
            .cmp(&right.port)
            .then(left.bind_address.cmp(&right.bind_address))
    });
    listeners
}

#[cfg(target_os = "linux")]
fn parse_socket_inode(target: &Path) -> Option<u64> {
    let target = target.to_str()?;
    let inode = target
        .strip_prefix("socket:[")?
        .strip_suffix(']')?
        .parse::<u64>()
        .ok()?;
    Some(inode)
}

#[cfg(target_os = "linux")]
fn read_local_bind_listeners_by_inode(
    proc_root: &Path,
) -> Result<BTreeMap<u64, ProcessListener>, RuntimeProcessesError> {
    let mut listeners = BTreeMap::new();

    for relative_path in ["net/tcp", "net/tcp6"] {
        let path = proc_root.join(relative_path);
        let Ok(contents) = fs::read_to_string(&path) else {
            continue;
        };
        for listener in parse_proc_net_listeners(&contents)? {
            listeners.insert(listener.inode, listener.listener);
        }
    }

    Ok(listeners)
}

#[cfg(target_os = "linux")]
fn parse_proc_net_listeners(
    contents: &str,
) -> Result<Vec<ListenerWithInode>, RuntimeProcessesError> {
    let mut listeners = Vec::new();

    for line in contents.lines().skip(1) {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        if fields.len() < 10 {
            continue;
        }
        if fields[3] != "0A" {
            continue;
        }
        let Some(listener) = parse_local_bind_listener(fields[1]) else {
            continue;
        };
        let inode = fields[9].parse::<u64>().map_err(|error| {
            RuntimeProcessesError::new(format!("invalid socket inode '{}': {error}", fields[9]))
        })?;
        listeners.push(ListenerWithInode { inode, listener });
    }

    Ok(listeners)
}

#[cfg(target_os = "linux")]
fn parse_local_bind_listener(socket_address: &str) -> Option<ProcessListener> {
    let (address_hex, port_hex) = socket_address.split_once(':')?;
    let port = u16::from_str_radix(port_hex, 16).ok()?;

    if address_hex.len() == 8 {
        let mut bytes = [0_u8; 4];
        for (index, chunk) in address_hex.as_bytes().chunks(2).enumerate() {
            let hex = std::str::from_utf8(chunk).ok()?;
            bytes[index] = u8::from_str_radix(hex, 16).ok()?;
        }
        let address = Ipv4Addr::new(bytes[3], bytes[2], bytes[1], bytes[0]);
        if !address.is_loopback() && !address.is_unspecified() {
            return None;
        }
        return Some(ProcessListener {
            port,
            bind_address: address.to_string(),
        });
    }

    if address_hex == "00000000000000000000000000000000" {
        return Some(ProcessListener {
            port,
            bind_address: "::".to_string(),
        });
    }

    if address_hex == "00000000000000000000000000000001"
        || address_hex == "00000000000000000000000001000000"
    {
        return Some(ProcessListener {
            port,
            bind_address: "::1".to_string(),
        });
    }

    None
}

#[cfg(target_os = "linux")]
struct ListenerWithInode {
    inode: u64,
    listener: ProcessListener,
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "linux")]
    use std::net::TcpStream;
    #[cfg(target_os = "linux")]
    use std::path::Path;
    #[cfg(target_os = "linux")]
    use std::process::{Child, Command, Stdio};
    #[cfg(target_os = "linux")]
    use std::thread;
    #[cfg(target_os = "linux")]
    use std::time::{Duration, Instant};

    #[cfg(target_os = "linux")]
    use crate::time::{Clock, format_rfc3339_timestamp, testing::MutableClock};
    #[cfg(target_os = "linux")]
    use crate::tunnel::runtime_processes::{
        collect_process_entries_for_proc_root, collect_processes_snapshot,
    };

    #[cfg(target_os = "linux")]
    #[test]
    fn collects_only_processes_with_local_bind_listeners() {
        let server_marker = format!("mistle_process_inventory_server_{}", std::process::id());
        let idle_marker = format!("mistle_process_inventory_idle_{}", std::process::id());
        let port = reserve_available_port();
        let mut server = spawn_node_process(&format!(
            "const tag='{server_marker}'; require('node:net').createServer(() => {{}}).listen({port}, '0.0.0.0'); setInterval(() => {{ void tag; }}, 1000);"
        ));
        let mut idle = spawn_node_process(&format!(
            "const tag='{idle_marker}'; setInterval(() => {{ void tag; }}, 1000);"
        ));

        wait_until_listening(port);

        let clock = MutableClock::new(1_744_278_400_000);
        let deadline = Instant::now() + Duration::from_secs(3);
        let snapshot = loop {
            let snapshot = collect_processes_snapshot(&clock)
                .expect("process inventory snapshot should succeed");
            let has_server = snapshot.processes.iter().any(|process| {
                process
                    .command
                    .as_deref()
                    .is_some_and(|command| command.contains(&server_marker))
            });
            let has_idle = snapshot.processes.iter().any(|process| {
                process
                    .command
                    .as_deref()
                    .is_some_and(|command| command.contains(&idle_marker))
            });
            if has_server && !has_idle {
                break snapshot;
            }
            assert!(
                Instant::now() < deadline,
                "expected only the local-bind listening server process to appear in the inventory snapshot"
            );
            thread::sleep(Duration::from_millis(25));
        };

        let server_process = snapshot
            .processes
            .iter()
            .find(|process| {
                process
                    .command
                    .as_deref()
                    .is_some_and(|command| command.contains(&server_marker))
            })
            .expect("server process should be present");
        assert!(
            server_process
                .listeners
                .iter()
                .any(|listener| listener.port == port && listener.bind_address == "0.0.0.0"),
            "server process should include its local-bind listener"
        );

        assert!(
            snapshot.processes.iter().all(|process| {
                !process
                    .command
                    .as_deref()
                    .is_some_and(|command| command.contains(&idle_marker))
            }),
            "idle process without local-bind listeners should be omitted"
        );
        assert_eq!(
            snapshot.observed_at,
            format_rfc3339_timestamp(clock.now_system_time())
                .expect("mutable clock timestamp should format")
        );

        terminate_child(&mut server);
        terminate_child(&mut idle);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn proc_root_scan_returns_entries_for_local_bind_processes() {
        let port = reserve_available_port();
        let server_marker = format!("mistle_proc_root_scan_server_{}", std::process::id());
        let mut server = spawn_node_process(&format!(
            "const tag='{server_marker}'; require('node:net').createServer(() => {{}}).listen({port}, '127.0.0.1'); setInterval(() => {{ void tag; }}, 1000);"
        ));

        wait_until_listening(port);

        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let processes = collect_process_entries_for_proc_root(Path::new("/proc"))
                .expect("proc scan should run");
            let maybe_server = processes.iter().find(|process| {
                process
                    .command
                    .as_deref()
                    .is_some_and(|command| command.contains(&server_marker))
            });
            if let Some(server_process) = maybe_server {
                assert!(
                    server_process.listeners.iter().any(|listener| {
                        listener.port == port && listener.bind_address == "127.0.0.1"
                    }),
                    "proc scan should include the expected local-bind listener"
                );
                break;
            }

            assert!(
                Instant::now() < deadline,
                "proc scan should discover the spawned local-bind server process"
            );
            thread::sleep(Duration::from_millis(25));
        }

        terminate_child(&mut server);
    }

    #[cfg(target_os = "linux")]
    fn spawn_node_process(source: &str) -> Child {
        Command::new("node")
            .args(["-e", source])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("node process should spawn")
    }

    #[cfg(target_os = "linux")]
    fn reserve_available_port() -> u16 {
        let listener =
            std::net::TcpListener::bind("127.0.0.1:0").expect("port reservation should bind");
        let port = listener
            .local_addr()
            .expect("reserved listener should expose a local address")
            .port();
        drop(listener);
        port
    }

    #[cfg(target_os = "linux")]
    fn wait_until_listening(port: u16) {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if TcpStream::connect(("127.0.0.1", port)).is_ok() {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for the test listener on port {port} to accept connections"
            );
            thread::sleep(Duration::from_millis(25));
        }
    }

    #[cfg(target_os = "linux")]
    fn terminate_child(child: &mut Child) {
        let _ = child.kill();
        let _ = child.wait();
    }
}
