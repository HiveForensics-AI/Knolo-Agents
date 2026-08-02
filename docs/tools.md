# Tools

Tools pair a serializable definition with a host-owned implementation. Definitions
include stable ids, capability and namespace, JSON argument/result contracts, and
side-effect metadata. Calls and results carry matching ids and resource usage.
Implementations remain outside checkpoints. Unit tests should use deterministic
local fakes and must not access the network.
