//! Platform helpers for transparent egress proxying.
//!
//! Linux builds recover the original destination and configure passthrough
//! upstream sockets; other targets fail explicitly because transparent routing
//! depends on Linux socket behavior.

#[cfg(target_os = "linux")]
use std::collections::BTreeSet;
#[cfg(target_os = "linux")]
use std::io::Write;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs};
#[cfg(target_os = "linux")]
use std::os::unix::io::AsRawFd;
use std::process::Command;
#[cfg(target_os = "linux")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "linux")]
use std::sync::{Arc, mpsc};
#[cfg(target_os = "linux")]
use std::thread::{self, JoinHandle};
#[cfg(target_os = "linux")]
use std::time::Duration;
#[cfg(target_os = "linux")]
use std::time::Instant;

#[cfg(target_os = "linux")]
use futures_util::StreamExt;
#[cfg(target_os = "linux")]
use rtnetlink::packet_core::NetlinkPayload;
#[cfg(target_os = "linux")]
use rtnetlink::packet_route::{
    AddressFamily, RouteNetlinkMessage,
    route::{RouteAddress, RouteAttribute, RouteHeader, RouteMessage, RouteScope},
};
#[cfg(target_os = "linux")]
use rtnetlink::{MulticastGroup, RouteMessageBuilder, new_connection, new_multicast_connection};
#[cfg(test)]
use serde::Deserialize;
#[cfg(target_os = "linux")]
use serde_json::Value;
use tokio::net::{TcpSocket, TcpStream};

#[cfg(target_os = "linux")]
use crate::egress_proxy::TRANSPARENT_PASSTHROUGH_SOCKET_MARK;
use crate::egress_proxy::logging::EgressProxyLogContext;
#[cfg(target_os = "linux")]
use crate::egress_proxy::logging::emit_egress_proxy_log;
use crate::egress_proxy::{
    EgressProxyError, STATIC_LOCAL_DESTINATION_IPV4_CIDRS, TRANSPARENT_NFTABLES_TABLE_NAME,
};
use crate::protocol::startup::{
    TransparentProxyBypassKind, TransparentProxyConfiguration, TransparentProxyExclusionKind,
};
#[cfg(target_os = "linux")]
use crate::time::SystemClock;

const LOCAL_DESTINATION_SET_NAME: &str = "local_destinations";
#[cfg(target_os = "linux")]
const LOCAL_DESTINATION_RECONCILE_INTERVAL: Duration = Duration::from_secs(30);
#[cfg(target_os = "linux")]
const LOCAL_DESTINATION_MONITOR_STARTUP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug)]
pub(super) struct TransparentPacketRules {
    pub(super) table_name: String,
    pub(super) local_destination_ipv4_cidrs: Vec<String>,
    pub(super) excluded_ipv4_cidrs: Vec<String>,
    #[cfg(target_os = "linux")]
    local_destination_reconciler: TransparentLocalDestinationReconciler,
}

#[cfg(target_os = "linux")]
#[derive(Clone, Debug)]
struct TransparentReconcilerLogContext {
    sandbox_instance_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct NftablesRulePlan {
    pub(super) table_name: String,
    listener_port: u16,
    passthrough_mark: u32,
    pub(super) local_destination_ipv4_cidrs: Vec<String>,
    pub(super) excluded_ipv4_cidrs: Vec<String>,
}

#[cfg(target_os = "linux")]
#[derive(Debug)]
pub(super) struct TransparentLocalDestinationReconciler {
    shutdown_requested: Arc<AtomicBool>,
    monitor_shutdown_sender: Option<tokio::sync::oneshot::Sender<()>>,
    monitor_thread: Option<JoinHandle<Result<(), EgressProxyError>>>,
    reconciler_thread: Option<JoinHandle<Result<(), EgressProxyError>>>,
}

#[cfg(target_os = "linux")]
impl TransparentLocalDestinationReconciler {
    pub(super) fn shutdown(mut self) -> Result<(), EgressProxyError> {
        self.shutdown_requested.store(true, Ordering::Relaxed);
        if let Some(sender) = self.monitor_shutdown_sender.take() {
            let _ = sender.send(());
        }
        if let Some(thread) = self.monitor_thread.take() {
            thread
                .join()
                .map_err(|_| EgressProxyError::new("netlink monitor thread panicked"))??;
        }
        if let Some(thread) = self.reconciler_thread.take() {
            thread
                .join()
                .map_err(|_| EgressProxyError::new("netlink reconciler thread panicked"))??;
        }
        Ok(())
    }
}

impl TransparentPacketRules {
    pub(super) fn install(
        configuration: &TransparentProxyConfiguration,
        listener_port: u16,
        log_context: EgressProxyLogContext<'_>,
    ) -> Result<Self, EgressProxyError> {
        #[cfg(not(target_os = "linux"))]
        let _ = log_context;
        let plan = build_nftables_rule_plan(configuration, listener_port)?;
        cleanup_transparent_nftables_table(&plan.table_name)?;
        install_nftables_rule_plan(&plan)?;
        #[cfg(target_os = "linux")]
        let local_destination_reconciler = match start_transparent_local_destination_reconciler(
            plan.table_name.clone(),
            LOCAL_DESTINATION_RECONCILE_INTERVAL,
            TransparentReconcilerLogContext {
                sandbox_instance_id: log_context.sandbox_instance_id.to_string(),
            },
        ) {
            Ok(reconciler) => reconciler,
            Err(error) => {
                return Err(cleanup_after_nftables_install_error(
                    &plan.table_name,
                    error,
                ));
            }
        };
        Ok(Self {
            table_name: plan.table_name,
            local_destination_ipv4_cidrs: plan.local_destination_ipv4_cidrs,
            excluded_ipv4_cidrs: plan.excluded_ipv4_cidrs,
            #[cfg(target_os = "linux")]
            local_destination_reconciler,
        })
    }

    pub(super) fn cleanup(self) -> Result<(), EgressProxyError> {
        #[cfg(target_os = "linux")]
        self.local_destination_reconciler.shutdown()?;
        cleanup_transparent_nftables_table(&self.table_name)
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
    let local_destination_ipv4_cidrs =
        canonicalize_ipv4_interval_set_cidrs(local_destination_ipv4_cidrs)?;
    excluded_ipv4_cidrs.retain(|cidr| !local_destination_ipv4_cidrs.contains(cidr));

    Ok(NftablesRulePlan {
        table_name: TRANSPARENT_NFTABLES_TABLE_NAME.to_string(),
        listener_port,
        passthrough_mark: configuration.passthrough_bypass.mark,
        local_destination_ipv4_cidrs,
        excluded_ipv4_cidrs,
    })
}

fn install_nftables_rule_plan(plan: &NftablesRulePlan) -> Result<(), EgressProxyError> {
    for command in build_nftables_install_commands(plan) {
        if let Err(error) = run_nft_command(&command) {
            return Err(cleanup_after_nftables_install_error(
                &plan.table_name,
                error,
            ));
        }
    }
    Ok(())
}

fn cleanup_after_nftables_install_error(
    table_name: &str,
    error: EgressProxyError,
) -> EgressProxyError {
    match cleanup_transparent_nftables_table(table_name) {
        Ok(()) => EgressProxyError::new(format!(
            "failed to install transparent proxy nftables rules: {error}"
        )),
        Err(cleanup_error) => EgressProxyError::new(format!(
            "failed to install transparent proxy nftables rules: {error}; additionally failed to clean up nftables table '{table_name}': {cleanup_error}"
        )),
    }
}

fn discover_local_destination_ipv4_cidrs() -> Result<Vec<String>, EgressProxyError> {
    #[cfg(target_os = "linux")]
    {
        discover_local_destination_ipv4_cidrs_with_rtnetlink()
    }

    #[cfg(not(target_os = "linux"))]
    {
        Err(EgressProxyError::new(
            "transparent proxy local destination route discovery requires Linux rtnetlink support",
        ))
    }
}

#[cfg(target_os = "linux")]
fn discover_local_destination_ipv4_cidrs_with_rtnetlink() -> Result<Vec<String>, EgressProxyError> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_io()
        .build()
        .map_err(|error| {
            EgressProxyError::new(format!(
                "failed to build rtnetlink route discovery runtime: {error}"
            ))
        })?;
    runtime.block_on(query_link_scope_ipv4_route_cidrs())
}

#[cfg(target_os = "linux")]
async fn query_link_scope_ipv4_route_cidrs() -> Result<Vec<String>, EgressProxyError> {
    let (connection, handle, _) = new_connection().map_err(|error| {
        EgressProxyError::new(format!(
            "failed to open rtnetlink route discovery socket: {error}"
        ))
    })?;
    tokio::spawn(connection);

    let route_request = RouteMessageBuilder::<Ipv4Addr>::new().build();
    let mut routes = handle.route().get(route_request).execute();
    let mut cidrs = Vec::new();
    while let Some(route) = routes.next().await {
        let route = route.map_err(|error| {
            EgressProxyError::new(format!(
                "failed to query transparent proxy local destination routes with rtnetlink: {error}"
            ))
        })?;
        if let Some(cidr) = route_message_link_scope_ipv4_destination_cidr(&route)? {
            cidrs.push(cidr);
        }
    }
    cidrs.sort();
    cidrs.dedup();
    Ok(cidrs)
}

#[cfg(target_os = "linux")]
fn route_message_link_scope_ipv4_destination_cidr(
    route: &RouteMessage,
) -> Result<Option<String>, EgressProxyError> {
    if route.header.address_family != AddressFamily::Inet
        || route.header.scope != RouteScope::Link
        || route_table_id(route) != u32::from(RouteHeader::RT_TABLE_MAIN)
    {
        return Ok(None);
    }

    for attribute in &route.attributes {
        if let RouteAttribute::Destination(RouteAddress::Inet(destination)) = attribute {
            return Ok(Some(format!(
                "{destination}/{}",
                route.header.destination_prefix_length
            )));
        }
    }

    Ok(None)
}

#[cfg(target_os = "linux")]
fn route_table_id(route: &RouteMessage) -> u32 {
    route
        .attributes
        .iter()
        .find_map(|attribute| match attribute {
            RouteAttribute::Table(table_id) => Some(*table_id),
            _ => None,
        })
        .unwrap_or_else(|| u32::from(route.header.table))
}

#[cfg(test)]
#[derive(Deserialize)]
struct Iproute2Route {
    dst: Option<String>,
}

#[cfg(test)]
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

#[cfg(test)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Ipv4Cidr {
    network_address: Ipv4Addr,
    prefix_length: u8,
}

impl Ipv4Cidr {
    fn contains(self, other: Self) -> bool {
        self.prefix_length <= other.prefix_length
            && (u32::from(self.network_address) & ipv4_prefix_mask(self.prefix_length))
                == (u32::from(other.network_address) & ipv4_prefix_mask(self.prefix_length))
    }

    fn to_cidr_string(self) -> String {
        format!("{}/{}", self.network_address, self.prefix_length)
    }
}

fn canonicalize_ipv4_interval_set_cidrs(
    cidrs: Vec<String>,
) -> Result<Vec<String>, EgressProxyError> {
    let mut parsed_cidrs = cidrs
        .iter()
        .map(|cidr| parse_ipv4_cidr_for_interval_set(cidr))
        .collect::<Result<Vec<_>, _>>()?;
    parsed_cidrs.sort_by_key(|cidr| (u32::from(cidr.network_address), cidr.prefix_length));
    parsed_cidrs.dedup();

    let mut canonical_cidrs: Vec<Ipv4Cidr> = Vec::new();
    for cidr in parsed_cidrs {
        if canonical_cidrs
            .iter()
            .any(|existing_cidr| existing_cidr.contains(cidr))
        {
            continue;
        }
        canonical_cidrs.push(cidr);
    }

    Ok(canonical_cidrs
        .into_iter()
        .map(Ipv4Cidr::to_cidr_string)
        .collect())
}

fn parse_ipv4_cidr_for_interval_set(value: &str) -> Result<Ipv4Cidr, EgressProxyError> {
    let (address, prefix) = value.split_once('/').ok_or_else(|| {
        EgressProxyError::new(format!(
            "transparent proxy IPv4 interval set CIDR '{value}' is missing a prefix length"
        ))
    })?;
    let prefix_length = prefix.parse::<u8>().map_err(|error| {
        EgressProxyError::new(format!(
            "transparent proxy IPv4 interval set CIDR '{value}' has invalid prefix length: {error}"
        ))
    })?;
    if prefix_length > 32 {
        return Err(EgressProxyError::new(format!(
            "transparent proxy IPv4 interval set CIDR '{value}' has prefix length greater than 32"
        )));
    }

    let ip_address = address.parse::<Ipv4Addr>().map_err(|error| {
        EgressProxyError::new(format!(
            "transparent proxy IPv4 interval set CIDR '{value}' has invalid IPv4 address: {error}"
        ))
    })?;
    let network_address = Ipv4Addr::from(u32::from(ip_address) & ipv4_prefix_mask(prefix_length));

    Ok(Ipv4Cidr {
        network_address,
        prefix_length,
    })
}

fn ipv4_prefix_mask(prefix_length: u8) -> u32 {
    if prefix_length == 0 {
        0
    } else {
        u32::MAX << (32 - u32::from(prefix_length))
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
            plan.table_name.clone(),
        ],
        vec![
            "add".to_string(),
            "chain".to_string(),
            "ip".to_string(),
            plan.table_name.clone(),
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
            "set".to_string(),
            "ip".to_string(),
            plan.table_name.clone(),
            LOCAL_DESTINATION_SET_NAME.to_string(),
            "{".to_string(),
            "type".to_string(),
            "ipv4_addr".to_string(),
            ";".to_string(),
            "flags".to_string(),
            "interval".to_string(),
            ";".to_string(),
            "}".to_string(),
        ],
        build_nftables_local_destination_set_add_command(
            &plan.table_name,
            &plan.local_destination_ipv4_cidrs,
        ),
        vec![
            "add".to_string(),
            "rule".to_string(),
            "ip".to_string(),
            plan.table_name.clone(),
            "output".to_string(),
            "meta".to_string(),
            "mark".to_string(),
            plan.passthrough_mark.to_string(),
            "counter".to_string(),
            "return".to_string(),
        ],
        vec![
            "add".to_string(),
            "rule".to_string(),
            "ip".to_string(),
            plan.table_name.clone(),
            "output".to_string(),
            "ip".to_string(),
            "daddr".to_string(),
            format!("@{LOCAL_DESTINATION_SET_NAME}"),
            "counter".to_string(),
            "return".to_string(),
        ],
    ];

    commands.extend(plan.excluded_ipv4_cidrs.iter().map(|cidr| {
        vec![
            "add".to_string(),
            "rule".to_string(),
            "ip".to_string(),
            plan.table_name.clone(),
            "output".to_string(),
            "ip".to_string(),
            "daddr".to_string(),
            cidr.clone(),
            "counter".to_string(),
            "return".to_string(),
        ]
    }));

    commands.push(vec![
        "add".to_string(),
        "rule".to_string(),
        "ip".to_string(),
        plan.table_name.clone(),
        "output".to_string(),
        "tcp".to_string(),
        "dport".to_string(),
        "1-65535".to_string(),
        "counter".to_string(),
        "redirect".to_string(),
        "to".to_string(),
        format!(":{}", plan.listener_port),
    ]);

    commands
}

fn build_nftables_local_destination_set_add_command(
    table_name: &str,
    cidrs: &[String],
) -> Vec<String> {
    let mut command = vec![
        "add".to_string(),
        "element".to_string(),
        "ip".to_string(),
        table_name.to_string(),
        LOCAL_DESTINATION_SET_NAME.to_string(),
        "{".to_string(),
    ];
    for (index, cidr) in cidrs.iter().enumerate() {
        if index > 0 {
            command.push(",".to_string());
        }
        command.push(cidr.clone());
    }
    command.push("}".to_string());
    command
}

#[cfg(any(test, target_os = "linux"))]
pub(super) fn build_nftables_local_destination_set_replace_script(
    table_name: &str,
    cidrs: &[String],
) -> String {
    let commands = [
        vec![
            "flush".to_string(),
            "set".to_string(),
            "ip".to_string(),
            table_name.to_string(),
            LOCAL_DESTINATION_SET_NAME.to_string(),
        ],
        build_nftables_local_destination_set_add_command(table_name, cidrs),
    ];
    commands
        .iter()
        .map(|command| command.join(" "))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

#[cfg(all(target_os = "linux", test))]
pub(super) fn start_transparent_local_destination_reconciler_for_table(
    configuration: &TransparentProxyConfiguration,
    listener_port: u16,
    table_name: &str,
    periodic_interval: Duration,
) -> Result<TransparentLocalDestinationReconciler, EgressProxyError> {
    let mut plan = build_nftables_rule_plan(configuration, listener_port)?;
    plan.table_name = table_name.to_string();
    cleanup_transparent_nftables_table(&plan.table_name)?;
    for command in build_nftables_install_commands(&plan) {
        run_nft_command(&command)?;
    }
    start_transparent_local_destination_reconciler(
        plan.table_name,
        periodic_interval,
        TransparentReconcilerLogContext {
            sandbox_instance_id: "sandboxd-test".to_string(),
        },
    )
}

#[cfg(target_os = "linux")]
fn start_transparent_local_destination_reconciler(
    table_name: String,
    periodic_interval: Duration,
    log_context: TransparentReconcilerLogContext,
) -> Result<TransparentLocalDestinationReconciler, EgressProxyError> {
    let shutdown_requested = Arc::new(AtomicBool::new(false));
    let (event_sender, event_receiver) = mpsc::channel();
    let (startup_sender, startup_receiver) = mpsc::channel();
    let (monitor_shutdown_sender, monitor_shutdown_receiver) = tokio::sync::oneshot::channel();

    let monitor_log_context = log_context.clone();
    let monitor_thread = thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_io()
            .build()
            .map_err(|error| {
                EgressProxyError::new(format!(
                    "failed to build rtnetlink monitor runtime: {error}"
                ))
            })?;
        runtime.block_on(run_rtnetlink_route_monitor(
            startup_sender,
            event_sender,
            monitor_shutdown_receiver,
            monitor_log_context,
        ))
    });
    startup_receiver
        .recv_timeout(LOCAL_DESTINATION_MONITOR_STARTUP_TIMEOUT)
        .map_err(|error| {
            EgressProxyError::new(format!(
                "timed out waiting for netlink monitor startup: {error}"
            ))
        })?;

    let reconciler_shutdown_requested = Arc::clone(&shutdown_requested);
    let reconciler_thread = thread::spawn(move || {
        let mut last_local_destination_ipv4_cidrs = Vec::new();
        reconcile_local_destination_set(
            &table_name,
            "startup",
            0,
            &mut last_local_destination_ipv4_cidrs,
            &log_context,
        )?;
        loop {
            if reconciler_shutdown_requested.load(Ordering::Relaxed) {
                return Ok(());
            }
            match event_receiver.recv_timeout(periodic_interval) {
                Ok(()) => {
                    let event_count = drain_pending_reconcile_events(&event_receiver) + 1;
                    reconcile_local_destination_set(
                        &table_name,
                        "rtnetlink_event",
                        event_count,
                        &mut last_local_destination_ipv4_cidrs,
                        &log_context,
                    )?;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    reconcile_local_destination_set(
                        &table_name,
                        "periodic",
                        0,
                        &mut last_local_destination_ipv4_cidrs,
                        &log_context,
                    )?;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
            }
        }
    });

    Ok(TransparentLocalDestinationReconciler {
        shutdown_requested,
        monitor_shutdown_sender: Some(monitor_shutdown_sender),
        monitor_thread: Some(monitor_thread),
        reconciler_thread: Some(reconciler_thread),
    })
}

#[cfg(target_os = "linux")]
async fn run_rtnetlink_route_monitor(
    startup_sender: mpsc::Sender<()>,
    event_sender: mpsc::Sender<()>,
    mut shutdown_receiver: tokio::sync::oneshot::Receiver<()>,
    log_context: TransparentReconcilerLogContext,
) -> Result<(), EgressProxyError> {
    let (connection, _handle, mut messages) = new_multicast_connection(&[
        MulticastGroup::Link,
        MulticastGroup::Ipv4Ifaddr,
        MulticastGroup::Ipv4Route,
    ])
    .map_err(|error| {
        EgressProxyError::new(format!("failed to open rtnetlink monitor socket: {error}"))
    })?;
    tokio::spawn(connection);
    emit_transparent_reconciler_log(
        &log_context,
        "egress_proxy_local_destination_monitor_started",
        &[
            ("source", Value::String("rtnetlink".to_string())),
            (
                "groups",
                Value::Array(
                    ["link", "ipv4_ifaddr", "ipv4_route"]
                        .iter()
                        .map(|group| Value::String((*group).to_string()))
                        .collect(),
                ),
            ),
        ],
    );
    startup_sender.send(()).map_err(|_| {
        EgressProxyError::new("failed to report rtnetlink monitor startup completion")
    })?;

    loop {
        tokio::select! {
            _ = &mut shutdown_receiver => return Ok(()),
            message = messages.next() => {
                let Some((message, _address)) = message else {
                    return Ok(());
                };
                let NetlinkPayload::InnerMessage(route_message) = &message.payload else {
                    continue;
                };
                if !route_netlink_message_should_reconcile(route_message) {
                    continue;
                }
                if event_sender.send(()).is_err() {
                    return Ok(());
                }
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn route_netlink_message_should_reconcile(message: &RouteNetlinkMessage) -> bool {
    matches!(
        message,
        RouteNetlinkMessage::NewLink(_)
            | RouteNetlinkMessage::DelLink(_)
            | RouteNetlinkMessage::NewAddress(_)
            | RouteNetlinkMessage::DelAddress(_)
            | RouteNetlinkMessage::NewRoute(_)
            | RouteNetlinkMessage::DelRoute(_)
    )
}

#[cfg(target_os = "linux")]
fn reconcile_local_destination_set(
    table_name: &str,
    trigger: &str,
    event_count: usize,
    last_local_destination_ipv4_cidrs: &mut Vec<String>,
    log_context: &TransparentReconcilerLogContext,
) -> Result<(), EgressProxyError> {
    let started_at = Instant::now();
    let discovered_cidrs = discover_local_destination_ipv4_cidrs();
    let cidrs = match discovered_cidrs {
        Ok(cidrs) => cidrs,
        Err(error) => {
            emit_reconcile_failed_log(
                log_context,
                table_name,
                trigger,
                event_count,
                started_at.elapsed(),
                &error,
            );
            return Err(error);
        }
    };
    let mut local_destination_ipv4_cidrs = STATIC_LOCAL_DESTINATION_IPV4_CIDRS
        .iter()
        .map(|cidr| (*cidr).to_string())
        .collect::<Vec<_>>();
    local_destination_ipv4_cidrs.extend(cidrs);
    let local_destination_ipv4_cidrs =
        match canonicalize_ipv4_interval_set_cidrs(local_destination_ipv4_cidrs) {
            Ok(cidrs) => cidrs,
            Err(error) => {
                emit_reconcile_failed_log(
                    log_context,
                    table_name,
                    trigger,
                    event_count,
                    started_at.elapsed(),
                    &error,
                );
                return Err(error);
            }
        };
    let (added_cidrs, removed_cidrs) = diff_cidrs(
        last_local_destination_ipv4_cidrs,
        &local_destination_ipv4_cidrs,
    );
    let replace_script = build_nftables_local_destination_set_replace_script(
        table_name,
        &local_destination_ipv4_cidrs,
    );
    if let Err(error) = run_nft_script(&replace_script) {
        emit_reconcile_failed_log(
            log_context,
            table_name,
            trigger,
            event_count,
            started_at.elapsed(),
            &error,
        );
        return Err(error);
    }
    *last_local_destination_ipv4_cidrs = local_destination_ipv4_cidrs.clone();
    emit_transparent_reconciler_log(
        log_context,
        "egress_proxy_local_destination_reconcile_completed",
        &[
            ("tableName", Value::String(table_name.to_string())),
            ("trigger", Value::String(trigger.to_string())),
            (
                "eventCount",
                Value::Number(serde_json::Number::from(event_count)),
            ),
            (
                "durationMs",
                Value::Number(serde_json::Number::from(
                    u64::try_from(started_at.elapsed().as_millis()).unwrap_or(u64::MAX),
                )),
            ),
            (
                "cidrCount",
                Value::Number(serde_json::Number::from(local_destination_ipv4_cidrs.len())),
            ),
            ("cidrs", string_array_value(&local_destination_ipv4_cidrs)),
            ("addedCidrs", string_array_value(&added_cidrs)),
            ("removedCidrs", string_array_value(&removed_cidrs)),
        ],
    );
    Ok(())
}

#[cfg(target_os = "linux")]
fn drain_pending_reconcile_events(event_receiver: &mpsc::Receiver<()>) -> usize {
    let mut count = 0;
    while event_receiver.try_recv().is_ok() {
        count += 1;
    }
    count
}

#[cfg(target_os = "linux")]
fn diff_cidrs(previous: &[String], current: &[String]) -> (Vec<String>, Vec<String>) {
    let previous_set = previous.iter().cloned().collect::<BTreeSet<_>>();
    let current_set = current.iter().cloned().collect::<BTreeSet<_>>();
    let added = current_set
        .difference(&previous_set)
        .cloned()
        .collect::<Vec<_>>();
    let removed = previous_set
        .difference(&current_set)
        .cloned()
        .collect::<Vec<_>>();
    (added, removed)
}

#[cfg(target_os = "linux")]
fn emit_reconcile_failed_log(
    log_context: &TransparentReconcilerLogContext,
    table_name: &str,
    trigger: &str,
    event_count: usize,
    duration: Duration,
    error: &EgressProxyError,
) {
    emit_transparent_reconciler_log(
        log_context,
        "egress_proxy_local_destination_reconcile_failed",
        &[
            ("tableName", Value::String(table_name.to_string())),
            ("trigger", Value::String(trigger.to_string())),
            (
                "eventCount",
                Value::Number(serde_json::Number::from(event_count)),
            ),
            (
                "durationMs",
                Value::Number(serde_json::Number::from(
                    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX),
                )),
            ),
            ("error", Value::String(error.to_string())),
        ],
    );
}

#[cfg(target_os = "linux")]
fn emit_transparent_reconciler_log(
    log_context: &TransparentReconcilerLogContext,
    event: &str,
    extra_fields: &[(&str, Value)],
) {
    emit_egress_proxy_log(
        &SystemClock,
        &log_context.sandbox_instance_id,
        event,
        extra_fields,
    );
}

#[cfg(target_os = "linux")]
fn string_array_value(values: &[String]) -> Value {
    Value::Array(values.iter().cloned().map(Value::String).collect())
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

#[cfg(target_os = "linux")]
fn run_nft_script(script: &str) -> Result<(), EgressProxyError> {
    let mut child = Command::new("nft")
        .args(["-f", "-"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| {
            EgressProxyError::new(format!("failed to execute nft batch command: {error}"))
        })?;
    let write_result = match child.stdin.take() {
        Some(mut stdin) => {
            let result = stdin.write_all(script.as_bytes()).map_err(|error| {
                EgressProxyError::new(format!("failed to write nft batch command stdin: {error}"))
            });
            drop(stdin);
            result
        }
        None => Err(EgressProxyError::new(
            "failed to open nft batch command stdin",
        )),
    };

    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(error) => {
            return Err(match &write_result {
                Ok(()) => {
                    EgressProxyError::new(format!("failed to wait for nft batch command: {error}"))
                }
                Err(write_error) => EgressProxyError::new(format!(
                    "{write_error}; additionally failed to wait for nft batch command: {error}"
                )),
            });
        }
    };
    if let Err(write_error) = write_result {
        if output.status.success() {
            return Err(write_error);
        }
        return Err(EgressProxyError::new(format!(
            "{write_error}; nft batch command exited with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    if output.status.success() {
        return Ok(());
    }

    Err(EgressProxyError::new(format!(
        "nft batch command failed with status {}: {}",
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
