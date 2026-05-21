use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
#[cfg(target_os = "linux")]
use std::os::unix::io::AsRawFd;
use std::process::Command;

use serde::Deserialize;
use tokio::net::{TcpSocket, TcpStream};

#[cfg(target_os = "linux")]
use crate::egress_proxy::TRANSPARENT_PASSTHROUGH_SOCKET_MARK;
use crate::egress_proxy::{
    EgressProxyError, STATIC_LOCAL_DESTINATION_IPV4_CIDRS, TRANSPARENT_NFTABLES_TABLE_NAME,
};
use crate::protocol::startup::{
    TransparentProxyBypassKind, TransparentProxyConfiguration, TransparentProxyExclusionKind,
};

#[derive(Debug)]
pub(super) struct TransparentPacketRules {
    pub(super) table_name: &'static str,
    pub(super) local_destination_ipv4_cidrs: Vec<String>,
    pub(super) excluded_ipv4_cidrs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct NftablesRulePlan {
    pub(super) table_name: &'static str,
    listener_port: u16,
    passthrough_mark: u32,
    pub(super) local_destination_ipv4_cidrs: Vec<String>,
    pub(super) excluded_ipv4_cidrs: Vec<String>,
}

impl TransparentPacketRules {
    pub(super) fn install(
        configuration: &TransparentProxyConfiguration,
        listener_port: u16,
    ) -> Result<Self, EgressProxyError> {
        let plan = build_nftables_rule_plan(configuration, listener_port)?;
        cleanup_transparent_nftables_table(plan.table_name)?;
        for command in build_nftables_install_commands(&plan) {
            run_nft_command(&command)?;
        }
        Ok(Self {
            table_name: plan.table_name,
            local_destination_ipv4_cidrs: plan.local_destination_ipv4_cidrs,
            excluded_ipv4_cidrs: plan.excluded_ipv4_cidrs,
        })
    }

    pub(super) fn cleanup(&self) -> Result<(), EgressProxyError> {
        cleanup_transparent_nftables_table(self.table_name)
    }
}

fn build_nftables_rule_plan(
    configuration: &TransparentProxyConfiguration,
    listener_port: u16,
) -> Result<NftablesRulePlan, EgressProxyError> {
    let local_destination_ipv4_cidrs = discover_local_destination_ipv4_cidrs()?;
    build_nftables_rule_plan_with_local_destinations(
        configuration,
        listener_port,
        local_destination_ipv4_cidrs,
    )
}

pub(super) fn build_nftables_rule_plan_with_local_destinations(
    configuration: &TransparentProxyConfiguration,
    listener_port: u16,
    discovered_local_destination_ipv4_cidrs: Vec<String>,
) -> Result<NftablesRulePlan, EgressProxyError> {
    if configuration.passthrough_bypass.kind != TransparentProxyBypassKind::SocketMark {
        return Err(EgressProxyError::new(
            "transparent proxy packet rules require socket-mark passthrough bypass",
        ));
    }
    if configuration.passthrough_bypass.mark == 0 {
        return Err(EgressProxyError::new(
            "transparent proxy socket-mark bypass value must be non-zero",
        ));
    }

    let mut excluded_ipv4_cidrs = Vec::new();
    for exclusion in &configuration.exclusions {
        match exclusion.kind {
            TransparentProxyExclusionKind::Cidr => {
                if let Some(ipv4_cidr) = normalize_ipv4_cidr(&exclusion.value)? {
                    excluded_ipv4_cidrs.push(ipv4_cidr);
                }
            }
            TransparentProxyExclusionKind::Host => {
                excluded_ipv4_cidrs.extend(resolve_host_exclusion_ipv4_cidrs(&exclusion.value)?);
            }
        }
    }
    excluded_ipv4_cidrs.sort();
    excluded_ipv4_cidrs.dedup();

    let mut local_destination_ipv4_cidrs = STATIC_LOCAL_DESTINATION_IPV4_CIDRS
        .iter()
        .map(|cidr| (*cidr).to_string())
        .collect::<Vec<_>>();
    for cidr in discovered_local_destination_ipv4_cidrs {
        if let Some(ipv4_cidr) = normalize_ipv4_cidr(&cidr)? {
            local_destination_ipv4_cidrs.push(ipv4_cidr);
        }
    }
    local_destination_ipv4_cidrs.sort();
    local_destination_ipv4_cidrs.dedup();
    excluded_ipv4_cidrs.retain(|cidr| !local_destination_ipv4_cidrs.contains(cidr));

    Ok(NftablesRulePlan {
        table_name: TRANSPARENT_NFTABLES_TABLE_NAME,
        listener_port,
        passthrough_mark: configuration.passthrough_bypass.mark,
        local_destination_ipv4_cidrs,
        excluded_ipv4_cidrs,
    })
}

fn discover_local_destination_ipv4_cidrs() -> Result<Vec<String>, EgressProxyError> {
    let output = Command::new("ip")
        .args(["-j", "-4", "route", "show", "table", "main", "scope", "link"])
        .output()
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to discover transparent proxy local destination routes with iproute2: {error}"
            ))
        })?;
    if !output.status.success() {
        return Err(EgressProxyError::new(format!(
            "failed to discover transparent proxy local destination routes: ip exited with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    parse_iproute2_link_scope_ipv4_route_cidrs(&output.stdout)
}

#[derive(Deserialize)]
struct Iproute2Route {
    dst: Option<String>,
}

pub(super) fn parse_iproute2_link_scope_ipv4_route_cidrs(
    route_json: &[u8],
) -> Result<Vec<String>, EgressProxyError> {
    let routes: Vec<Iproute2Route> = serde_json::from_slice(route_json).map_err(|error| {
        EgressProxyError::new(format!(
            "failed to parse transparent proxy local destination routes from iproute2 JSON: {error}"
        ))
    })?;

    let mut cidrs = Vec::new();
    for route in routes {
        let Some(destination) = route.dst else {
            continue;
        };
        if destination == "default" {
            continue;
        }
        cidrs.push(normalize_ipv4_route_destination(&destination)?);
    }
    cidrs.sort();
    cidrs.dedup();
    Ok(cidrs)
}

fn normalize_ipv4_route_destination(value: &str) -> Result<String, EgressProxyError> {
    if value.contains('/') {
        return normalize_ipv4_cidr(value)?.ok_or_else(|| {
            EgressProxyError::new(format!(
                "transparent proxy local destination route '{value}' is not IPv4"
            ))
        });
    }

    match value.parse::<IpAddr>().map_err(|error| {
        EgressProxyError::new(format!(
            "transparent proxy local destination route '{value}' has invalid IP address: {error}"
        ))
    })? {
        IpAddr::V4(ipv4_address) => Ok(format!("{ipv4_address}/32")),
        IpAddr::V6(_) => Err(EgressProxyError::new(format!(
            "transparent proxy local destination route '{value}' is not IPv4"
        ))),
    }
}

fn normalize_ipv4_cidr(value: &str) -> Result<Option<String>, EgressProxyError> {
    let (address, prefix) = value.split_once('/').ok_or_else(|| {
        EgressProxyError::new(format!(
            "transparent proxy CIDR exclusion '{value}' is missing a prefix length"
        ))
    })?;
    let prefix_length = prefix.parse::<u8>().map_err(|error| {
        EgressProxyError::new(format!(
            "transparent proxy CIDR exclusion '{value}' has invalid prefix length: {error}"
        ))
    })?;
    let ip_address = address.parse::<IpAddr>().map_err(|error| {
        EgressProxyError::new(format!(
            "transparent proxy CIDR exclusion '{value}' has invalid IP address: {error}"
        ))
    })?;

    match ip_address {
        IpAddr::V4(ipv4_address) => {
            if prefix_length > 32 {
                return Err(EgressProxyError::new(format!(
                    "transparent proxy IPv4 CIDR exclusion '{value}' has prefix length greater than 32"
                )));
            }
            Ok(Some(format!("{ipv4_address}/{prefix_length}")))
        }
        IpAddr::V6(_) => {
            if prefix_length > 128 {
                return Err(EgressProxyError::new(format!(
                    "transparent proxy IPv6 CIDR exclusion '{value}' has prefix length greater than 128"
                )));
            }
            Ok(None)
        }
    }
}

fn resolve_host_exclusion_ipv4_cidrs(host: &str) -> Result<Vec<String>, EgressProxyError> {
    let socket_addresses = (host, 0).to_socket_addrs().map_err(|error| {
        EgressProxyError::new(format!(
            "failed to resolve transparent proxy host exclusion '{host}': {error}"
        ))
    })?;
    let mut cidrs = socket_addresses
        .filter_map(|socket_address| match socket_address.ip() {
            IpAddr::V4(ipv4_address) => Some(format!("{ipv4_address}/32")),
            IpAddr::V6(_) => None,
        })
        .collect::<Vec<_>>();
    cidrs.sort();
    cidrs.dedup();
    if cidrs.is_empty() {
        return Err(EgressProxyError::new(format!(
            "transparent proxy host exclusion '{host}' did not resolve to an IPv4 address"
        )));
    }
    Ok(cidrs)
}

pub(super) fn build_nftables_install_commands(plan: &NftablesRulePlan) -> Vec<Vec<String>> {
    let mut commands = vec![
        vec![
            "add".to_string(),
            "table".to_string(),
            "ip".to_string(),
            plan.table_name.to_string(),
        ],
        vec![
            "add".to_string(),
            "chain".to_string(),
            "ip".to_string(),
            plan.table_name.to_string(),
            "output".to_string(),
            "{".to_string(),
            "type".to_string(),
            "nat".to_string(),
            "hook".to_string(),
            "output".to_string(),
            "priority".to_string(),
            "-100".to_string(),
            ";".to_string(),
            "policy".to_string(),
            "accept".to_string(),
            ";".to_string(),
            "}".to_string(),
        ],
        vec![
            "add".to_string(),
            "rule".to_string(),
            "ip".to_string(),
            plan.table_name.to_string(),
            "output".to_string(),
            "meta".to_string(),
            "mark".to_string(),
            plan.passthrough_mark.to_string(),
            "log".to_string(),
            "prefix".to_string(),
            nft_string_literal("mistle-tproxy-bypass=mark"),
            "return".to_string(),
        ],
    ];

    commands.extend(plan.local_destination_ipv4_cidrs.iter().map(|cidr| {
        vec![
            "add".to_string(),
            "rule".to_string(),
            "ip".to_string(),
            plan.table_name.to_string(),
            "output".to_string(),
            "ip".to_string(),
            "daddr".to_string(),
            cidr.clone(),
            "log".to_string(),
            "prefix".to_string(),
            nft_string_literal(&format!("mistle-tproxy-bypass=local:{cidr}")),
            "return".to_string(),
        ]
    }));

    commands.extend(plan.excluded_ipv4_cidrs.iter().map(|cidr| {
        vec![
            "add".to_string(),
            "rule".to_string(),
            "ip".to_string(),
            plan.table_name.to_string(),
            "output".to_string(),
            "ip".to_string(),
            "daddr".to_string(),
            cidr.clone(),
            "log".to_string(),
            "prefix".to_string(),
            nft_string_literal(&format!("mistle-tproxy-bypass=excluded:{cidr}")),
            "return".to_string(),
        ]
    }));

    commands.push(vec![
        "add".to_string(),
        "rule".to_string(),
        "ip".to_string(),
        plan.table_name.to_string(),
        "output".to_string(),
        "tcp".to_string(),
        "dport".to_string(),
        "1-65535".to_string(),
        "redirect".to_string(),
        "to".to_string(),
        format!(":{}", plan.listener_port),
    ]);

    commands
}

fn nft_string_literal(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn run_nft_command(arguments: &[String]) -> Result<(), EgressProxyError> {
    let output = Command::new("nft")
        .args(arguments)
        .output()
        .map_err(|error| {
            EgressProxyError::new(format!("failed to execute nft command: {error}"))
        })?;
    if output.status.success() {
        return Ok(());
    }

    Err(EgressProxyError::new(format!(
        "nft command failed with status {}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr).trim()
    )))
}

pub(super) fn cleanup_transparent_nftables_table(table_name: &str) -> Result<(), EgressProxyError> {
    let output = Command::new("nft")
        .args(["delete", "table", "ip", table_name])
        .output()
        .map_err(|error| {
            EgressProxyError::new(format!("failed to execute nft cleanup command: {error}"))
        })?;
    if output.status.success() || nft_delete_table_error_is_absent(&output.stderr) {
        return Ok(());
    }

    Err(EgressProxyError::new(format!(
        "nft cleanup command failed with status {}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr).trim()
    )))
}

fn nft_delete_table_error_is_absent(stderr: &[u8]) -> bool {
    let stderr_text = String::from_utf8_lossy(stderr);
    stderr_text.contains("No such file or directory")
        || stderr_text.contains("No such table")
        || stderr_text.contains("does not exist")
}

#[cfg(target_os = "linux")]
pub(super) fn recover_original_destination(
    stream: &TcpStream,
) -> Result<SocketAddr, EgressProxyError> {
    let socket_fd = stream.as_raw_fd();
    let (socket_level, socket_option) = match stream.local_addr() {
        Ok(SocketAddr::V4(_)) => (nix::libc::SOL_IP, nix::libc::SO_ORIGINAL_DST),
        Ok(SocketAddr::V6(_)) => (nix::libc::IPPROTO_IPV6, nix::libc::IP6T_SO_ORIGINAL_DST),
        Err(error) => {
            return Err(EgressProxyError::new(format!(
                "failed to inspect transparent egress local address: {error}"
            )));
        }
    };
    let mut sockaddr = std::mem::MaybeUninit::<nix::libc::sockaddr_storage>::zeroed();
    let mut sockaddr_length: nix::libc::socklen_t =
        std::mem::size_of::<nix::libc::sockaddr_storage>()
            .try_into()
            .map_err(|_| EgressProxyError::new("sockaddr storage length does not fit socklen_t"))?;
    let result = unsafe {
        nix::libc::getsockopt(
            socket_fd,
            socket_level,
            socket_option,
            sockaddr.as_mut_ptr().cast(),
            &mut sockaddr_length,
        )
    };
    if result != 0 {
        return Err(EgressProxyError::new(format!(
            "failed to recover transparent egress original destination: {}",
            std::io::Error::last_os_error()
        )));
    }

    let sockaddr = unsafe { sockaddr.assume_init() };
    socket_addr_from_sockaddr_storage(sockaddr, sockaddr_length)
}

#[cfg(not(target_os = "linux"))]
pub(super) fn recover_original_destination(
    _stream: &TcpStream,
) -> Result<SocketAddr, EgressProxyError> {
    Err(EgressProxyError::new(
        "transparent egress original destination lookup requires Linux SO_ORIGINAL_DST",
    ))
}

#[cfg(target_os = "linux")]
pub(super) fn socket_addr_from_sockaddr_storage(
    sockaddr: nix::libc::sockaddr_storage,
    sockaddr_length: nix::libc::socklen_t,
) -> Result<SocketAddr, EgressProxyError> {
    match sockaddr.ss_family.into() {
        nix::libc::AF_INET => {
            let expected_length = std::mem::size_of::<nix::libc::sockaddr_in>();
            if usize::try_from(sockaddr_length)
                .ok()
                .is_none_or(|length| length < expected_length)
            {
                return Err(EgressProxyError::new(
                    "SO_ORIGINAL_DST returned a truncated IPv4 socket address",
                ));
            }
            let sockaddr_in = unsafe {
                std::ptr::addr_of!(sockaddr)
                    .cast::<nix::libc::sockaddr_in>()
                    .read_unaligned()
            };
            let address = std::net::Ipv4Addr::from(u32::from_be(sockaddr_in.sin_addr.s_addr));
            let port = u16::from_be(sockaddr_in.sin_port);
            Ok(SocketAddr::from((address, port)))
        }
        nix::libc::AF_INET6 => {
            let expected_length = std::mem::size_of::<nix::libc::sockaddr_in6>();
            if usize::try_from(sockaddr_length)
                .ok()
                .is_none_or(|length| length < expected_length)
            {
                return Err(EgressProxyError::new(
                    "SO_ORIGINAL_DST returned a truncated IPv6 socket address",
                ));
            }
            let sockaddr_in6 = unsafe {
                std::ptr::addr_of!(sockaddr)
                    .cast::<nix::libc::sockaddr_in6>()
                    .read_unaligned()
            };
            let address = std::net::Ipv6Addr::from(sockaddr_in6.sin6_addr.s6_addr);
            let port = u16::from_be(sockaddr_in6.sin6_port);
            Ok(SocketAddr::from((address, port)))
        }
        family => Err(EgressProxyError::new(format!(
            "SO_ORIGINAL_DST returned unsupported socket family {family}"
        ))),
    }
}

#[cfg(target_os = "linux")]
pub(super) fn configure_transparent_passthrough_upstream_socket(
    socket: &TcpSocket,
) -> Result<(), EgressProxyError> {
    nix::sys::socket::setsockopt(
        socket,
        nix::sys::socket::sockopt::Mark,
        &TRANSPARENT_PASSTHROUGH_SOCKET_MARK,
    )
    .map_err(|error| {
        EgressProxyError::new(format!(
            "failed to mark transparent passthrough upstream socket: {error}"
        ))
    })
}

#[cfg(not(target_os = "linux"))]
pub(super) fn configure_transparent_passthrough_upstream_socket(
    _socket: &TcpSocket,
) -> Result<(), EgressProxyError> {
    Ok(())
}
