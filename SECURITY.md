# Security Policy

## Supported Versions

Only the current code on the [`main`](https://github.com/Emmy123222/Stellar-GreenPay) branch receives security fixes. Older tags/releases are not patched.

| Version / branch | Supported |
|------------------|-----------|
| `main` (latest release) | ✅ |
| Older releases and tags | ❌ |
| Testnet-only deployments | ❌ (out of scope, see below) |

## Reporting a Vulnerability

We take the security of Stellar-GreenPay seriously. If you discover a security vulnerability, please report it to us responsibly.

Please do **not** report security vulnerabilities through public GitHub issues.

Instead, please use one of the following methods:
- **GitHub Security Advisories (preferred):** open a private report at
  [`security/advisories/new`](https://github.com/Emmy123222/Stellar-GreenPay/security/advisories/new).
  The report is visible only to the maintainers.
- **Private email:** email the maintainers using the contact address listed on
  their [GitHub profile](https://github.com/Emmy123222) with the subject
  `[SECURITY] <short summary>`.

Include in your report: affected component and version/commit, reproduction
steps, impact, and any known mitigations.

## Response Service Level Agreement (SLA)

We are committed to resolving security issues promptly. Our response SLA is as follows:
- **Acknowledgement**: We will acknowledge receipt of your vulnerability report within **48 hours**.
- **Patch/Resolution**: For critical vulnerabilities, we aim to provide a patch or mitigation within **30 days**.

## Out-of-Scope Issues

The following issues are currently considered out of scope for our security response:
- Issues or vulnerabilities that are strictly applicable to **testnet-only** environments.
- Rate limiting bypasses that do not demonstrate a tangible, real-world security impact.
- Volumetric or application-level Denial of Service (DoS) attacks.
- Social engineering or phishing attacks.

## Bug Bounty Scope

At this time, we do not have an active, paid bug bounty program. However, we deeply appreciate community contributions and will gladly provide public acknowledgment or credit to security researchers who responsibly disclose valid vulnerabilities.



## Implemented Security Controls

This document covers how to **report** a vulnerability. For a reference on the
security controls already implemented in the codebase — file-upload validation,
allowed types, rate limits and security log events — see
[docs/security.md](docs/security.md).
