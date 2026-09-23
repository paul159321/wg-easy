---
title: Edit Client
---

## General

- **Name**: The name of the client.
- **Enabled**: Whether the client can connect to the VPN.
- **Expire Date**: The date the client will be disabled.

## Bandwidth limits

Administrators can set per-client limits using the speedometer button on a client card or the **Bandwidth limits** section of the client editor. Download appears first, followed by upload. Directions are from the client's perspective.

- **Download**: Traffic sent from the VPN server to the client.
- **Upload**: Traffic sent from the client to the VPN server.
- Values are in **Mbps** (megabits per second), from **0.01 to 10000**, with up to two decimal places. Use **0** or leave a field blank for no limit in that direction.

Each client has independent upload and download limits. IPv4 and IPv6 share the same limit in each direction. Changes apply immediately and persist across restarts. Existing clients remain unlimited after upgrading. The live transfer display is unchanged.

Only administrators can change limits, including through the API. Limits apply to the client's assigned VPN addresses. **Server Allowed IPs must be empty** when limits are enabled; routing additional subnets behind a client is not supported with bandwidth limits.

The server uses Linux traffic control policing: packets above the configured rate are dropped, with a small burst allowance. This caps traffic; it does not guarantee bandwidth or fair sharing. Short measurements can exceed the configured rate, and TCP throughput may be lower because of packet loss. Traffic outside the VPN is unaffected.

The official container includes `tc`. The host kernel must support `sch_clsact`, `cls_flower`, and `act_police`, either built in or as loadable modules. The existing `NET_ADMIN` capability is sufficient; no additional device or container is required. If a limit cannot be applied, the update reports an error and attempts to restore the previous settings and rules. If restoration also fails, check the server logs and restart the interface before retrying.

For custom traffic-control configurations, wg-easy reserves filter priorities **49152** and **49153** on the VPN interface in both directions. Leave those priorities unused. Other priorities and the root queueing discipline are preserved.

## Address

- **IPv4**: The IPv4 address of the client.
- **IPv6**: The IPv6 address of the client.

## Allowed IPs

Which IPs will be routed through the VPN.

This will not prevent the user from modifying it locally and accessing IP ranges that they should not be able to access.

Use the Firewall Allowed IPs feature to prevent access to IP ranges that the user should not be able to access.

## Firewall Allowed IPs

/// note | Attention

This field only appears when **Per-Client Firewall** is enabled in the Admin Panel → Interface settings.

///

Server-side firewall rules that restrict which destinations the client can access, regardless of their local configuration.

Unlike "Allowed IPs" which only controls routing on the client side, these rules are enforced by the server using iptables/ip6tables and cannot be bypassed by the client.

**Supported Formats:**

- `10.10.0.3`, `2001:db8::1` - Allow access to a single IP address
- `10.10.0.0/24`, `2001:db8::/32` - Allow access to an entire subnet
- `192.168.1.5:443` - Allow access to specific port (TCP+UDP)
- `192.168.1.5:443/tcp` - Allow access to specific port (TCP only)
- `192.168.1.5:443/udp` - Allow access to specific port (UDP only)
- `10.10.0.0/24:443` - Allow access to an entire subnet on a specific port (TCP+UDP)
- `10.10.0.0/24:443/tcp` - Allow access to an entire subnet on a specific port (TCP only)
- `10.10.0.0/24:443/udp` - Allow access to an entire subnet on a specific port (UDP only)
- `[2001:db8::1]:443` - IPv6 address with port (brackets required)
- `[2001:db8::/32]:443/tcp` - IPv6 CIDR with port and protocol

/// warning | Invalid Formats

Protocol specifiers (`/tcp` or `/udp`) require a port number. The following formats are **not supported** and will result in an error:

- `10.10.0.3/tcp` (use `10.10.0.3:443/tcp` instead)
- `10.10.0.0/24/udp` (use `10.10.0.0/24:53/udp` instead)

///

**Behavior:**

- **Empty**: Falls back to the client's "Allowed IPs" setting
- **Specified**: Only listed destinations are accessible (allow-only, everything else is blocked)
- **Disable for specific client**: To disable firewall filtering for a single client while keeping it enabled for others, add `0.0.0.0/0, ::/0` to allow all traffic

/// note

To allow clients to reach the VPN server itself (e.g. for DNS), include the server's VPN address in the firewall allowed IPs.

///

**Use Case Examples**:

- Allow only specific servers: `10.10.0.5`
- Allow only internal network: `10.10.0.0/24, 192.168.1.0/24`
- Allow only web browsing: `0.0.0.0/0:80, 0.0.0.0/0:443, [::/0]:80, [::/0]:443`
- Block internet, allow LAN: Leave "Allowed IPs" as `0.0.0.0/0, ::/0` but set Firewall IPs to `10.0.0.0/8, 192.168.0.0/16`

## Server Allowed IPs

Which IPs will be routed to the client.

## DNS

The DNS server that the client will use.

## Advanced

- **MTU**: The maximum transmission unit for the client.
- **Persistent Keepalive**: The interval for sending keepalive packets to the server.

## Hooks

This can only be used for clients that use `wg-quick`. Setting this will throw a error when importing the config on other clients.

- **PreUp**: Commands to run before the interface is brought up.
- **PostUp**: Commands to run after the interface is brought up.
- **PreDown**: Commands to run before the interface is brought down.
- **PostDown**: Commands to run after the interface is brought down.

## Actions

- **Save**: Save the changes made in the form.
- **Revert**: Revert the changes made in the form.
- **Delete**: Delete the client.
