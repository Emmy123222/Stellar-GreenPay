# Security Policy

## Automated Secret Scanning

Every pull request targeting `main`, as well as every push, is scanned by Gitleaks
in GitHub Actions before the change can merge. The scan checks the full repository
history for API keys, private keys, database credentials, and other hardcoded
secrets. Test fixtures, environment templates, and other deterministic sample
values are covered by the repository's `.gitleaks.toml` allowlist; real credentials
must never be added to source control.

## Reporting a Vulnerability

We take the security of Stellar-GreenPay seriously. If you discover a security vulnerability, please report it to us responsibly. 

Please do **not** report security vulnerabilities through public GitHub issues.

Instead, please use one of the following methods:
- Send a private disclosure email to our security team.
- Use **GitHub Security Advisories** to privately report a vulnerability to the maintainers of this repository.

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



