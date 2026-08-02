# Security model

Trust boundaries are the untrusted graph/pack, trusted policy compiler, host-owned
effect implementations, external `@knolo/core`, and checkpoint/event storage.
Validate all versioned input, deny unknown capabilities, constrain arguments and
budgets, redact events, bind resumes to artifact hashes, narrow handoffs, and keep
secrets only in host memory. Report vulnerabilities using `SECURITY.md`.
