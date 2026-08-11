# Security Policy

Do not publish exploits, private world data, player programs, credentials, or a working sandbox escape in a public issue. Use the repository host's private security-advisory feature when available, and include the affected commit, a minimal reproduction, impact, and remediation notes.

## Local Development Boundary

The TypeScript player-program runner uses Node.js `vm` only for local single-user development. It is not a hostile-code isolation boundary and must not be exposed to untrusted public users.

Public or multi-tenant deployments must use process or container isolation for player programs, TLS, authenticated authorization, browser Origin validation, rate limits, protected persistence, audit logs, and secure secret management. The game must consume the deployed Nexora Engine security policy for package, protocol, and module execution boundaries.
