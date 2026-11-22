/** Rejects validator state values outside the node protocol. */
export function validatorState(value) {
    if (value === "eligible" || value === "exit_requested") {
        return value;
    }
    throw new TypeError("invalid validator state");
}
/** Validators may waive their commission; rates otherwise advance in one-tenth-percent steps. */
export const MIN_VALIDATOR_COMMISSION_BPS = 0;
export const MAX_VALIDATOR_COMMISSION_BPS = 1_000;
export const VALIDATOR_COMMISSION_STEP_BPS = 10;
export const DEFAULT_VALIDATOR_COMMISSION_BPS = 500;
/** Rejects validator inactivity reasons outside the node protocol. */
export function validatorInactiveReason(value) {
    if (value === "exit_requested" ||
        value === "activation_pending" ||
        value === "heartbeat_expired" ||
        value === "jailed") {
        return value;
    }
    throw new TypeError("invalid validator inactive_reasons");
}
