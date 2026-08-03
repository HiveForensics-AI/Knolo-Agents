//! Caller authorization for controller-gated and run-gated methods (Phase 3).
use crate::dto::HealthDto;
use crate::limits::RuntimeLimitsV1;
use candid::Principal;

/// Controller check used for load_definition / clear / set_limits.
pub fn require_controller(caller: Principal, is_controller: bool) -> Result<(), HealthDto> {
    if is_controller {
        Ok(())
    } else {
        Err(HealthDto::err(format!(
            "Unauthorized: caller {caller} is not a controller of this canister."
        )))
    }
}

/// Run authorization: controllers always allowed; otherwise allowed_callers or open.
pub fn require_run_access(
    caller: Principal,
    is_controller: bool,
    limits: &RuntimeLimitsV1,
) -> Result<(), HealthDto> {
    if is_controller {
        return Ok(());
    }
    if limits.require_controller_for_runs {
        return Err(HealthDto::err(format!(
            "Unauthorized: runs require a controller (caller {caller})."
        )));
    }
    if limits.allowed_callers.is_empty() {
        return Ok(());
    }
    let text = caller.to_text();
    if limits.allowed_callers.iter().any(|p| p == &text) {
        Ok(())
    } else {
        Err(HealthDto::err(format!(
            "Unauthorized: caller {caller} is not in allowed_callers."
        )))
    }
}

/// Cycles reserve guard (best-effort; 0 disables).
pub fn require_cycles_reserve(
    balance: Option<u128>,
    limits: &RuntimeLimitsV1,
) -> Result<(), String> {
    if limits.min_cycles_reserve == 0 {
        return Ok(());
    }
    match balance {
        Some(b) if b < limits.min_cycles_reserve => Err(format!(
            "cycles reserve too low: balance {b} < min {}",
            limits.min_cycles_reserve
        )),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_runs_when_no_allowlist() {
        let limits = RuntimeLimitsV1::default();
        let anon = Principal::anonymous();
        assert!(require_run_access(anon, false, &limits).is_ok());
    }

    #[test]
    fn allowlist_enforced() {
        let limits = RuntimeLimitsV1 {
            allowed_callers: vec!["aaaaa-aa".into()],
            ..RuntimeLimitsV1::default()
        };
        let anon = Principal::anonymous();
        assert!(require_run_access(anon, false, &limits).is_err());
        assert!(require_run_access(anon, true, &limits).is_ok());
    }
}
