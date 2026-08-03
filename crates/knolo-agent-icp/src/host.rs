//! ICP Host adapters for Phase 1: clock, checkpoints, event sink (in-memory).
use knolo_agent::checkpoint::InMemoryCheckpointStore;
use knolo_agent::runtime::{FixedClock, VecEventSink};

pub type IcpCheckpointStore = InMemoryCheckpointStore;
pub type IcpEventSink = VecEventSink;
pub type IcpClock = FixedClock;

/// Deterministic wall-clock for Phase 1 conformance (matches native FixedClock tests).
pub const DETERMINISTIC_NOW_MS: u64 = 1;

pub fn fixed_clock() -> IcpClock {
    FixedClock(DETERMINISTIC_NOW_MS)
}

pub fn empty_store() -> IcpCheckpointStore {
    InMemoryCheckpointStore::default()
}

pub fn empty_sink() -> IcpEventSink {
    VecEventSink::default()
}
