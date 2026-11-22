import { parseAtoms } from "../amount.js";
import { MAX_VALIDATOR_COMMISSION_BPS, MIN_VALIDATOR_COMMISSION_BPS, VALIDATOR_COMMISSION_STEP_BPS, validatorInactiveReason, validatorState, } from "../types/staking.js";
import { U32, address, addresses, hash384, hex, whole } from "../validate.js";
import { MAX_ADDRESS_BATCH, pageQuery } from "./address.js";
const MLDSA65_PUBLIC_KEY_HEX_LENGTH = 3_904;
const MAX_VALIDATOR_OVERLAY_ENDPOINT_HEX_LENGTH = 2_326;
const VALIDATOR_INACTIVE_REASON_ORDER = ["exit_requested", "activation_pending", "heartbeat_expired", "jailed"];
export class StakingApi {
    #http;
    /** @internal */
    constructor(http) {
        this.#http = http;
    }
    /** `GET /v1/staking/validators`: registered validators and the total bonded stake, paged. */
    async validators(options = {}) {
        return checkedValidatorList(await this.#http.get("/v1/staking/validators", pageQuery(options), options));
    }
    /** `GET /v1/staking/uptime`: cuts each validator signed over the last 10,000. */
    async uptime(options) {
        return checkedValidatorUptimeList(await this.#http.get("/v1/staking/uptime", undefined, options));
    }
    /** `GET /v1/staking/validators/{id}`: one validator with its self-bond. */
    async validator(validatorId, options) {
        const id = hash384(validatorId, "validatorId");
        const detail = checkedValidatorDetail(await this.#http.get(`/v1/staking/validators/${id}`, undefined, options));
        if (detail.validator.validator_id !== id) {
            throw new TypeError("invalid validator detail id");
        }
        return detail;
    }
    /** `GET /v1/staking/validators/{id}/slash`: active, retained slash data for one validator. */
    validatorSlash(validatorId, options) {
        const id = hash384(validatorId, "validatorId");
        return this.#http
            .get(`/v1/staking/validators/${id}/slash`, undefined, options)
            .then((value) => checkedValidatorSlashStatus(value, id));
    }
    /** `GET /v1/staking/validators/{id}/positions`: the validator's stake positions, paged, with its totals. */
    validatorPositions(validatorId, options = {}) {
        const id = hash384(validatorId, "validatorId");
        return this.#http
            .get(`/v1/staking/validators/${id}/positions`, pageQuery(options), options)
            .then((value) => checkedValidatorPositionList(value, id));
    }
    /** `POST /v1/staking/positions`: stake positions owned by up to 64 addresses, paged. */
    positions(owners, options = {}) {
        return this.#http
            .post("/v1/staking/positions", { api_version: 1, addresses: addresses(owners, MAX_ADDRESS_BATCH) }, pageQuery(options), options)
            .then(checkedStakePositionList);
    }
    /** `GET /v1/staking/positions/{id}`: one stake position. */
    position(positionId, options) {
        const id = hash384(positionId, "positionId");
        return this.#http
            .get(`/v1/staking/positions/${id}`, undefined, options)
            .then((value) => checkedStakePositionDetail(value, id));
    }
}
function checkedValidatorList(value) {
    const document = value;
    if (!isRecord(value) || value.api_version !== 1 || !Array.isArray(value.validators)) {
        throw new TypeError("invalid validator list");
    }
    whole(value.finalized_height, "finalized_height");
    atom(value.total_bonded, "total_bonded");
    positiveAtom(value.minimum_delegation, "minimum_delegation");
    positiveAtom(value.minimum_self_bond, "minimum_self_bond");
    const validatorCapacity = capacity(value.validator_capacity, "validator_capacity");
    const availableValidatorSlots = whole(value.available_validator_slots, "available_validator_slots", U32);
    if (availableValidatorSlots > validatorCapacity) {
        throw new RangeError("invalid available_validator_slots");
    }
    const positionCapacity = capacity(value.position_capacity, "position_capacity");
    const livePositions = whole(value.live_positions, "live_positions", U32);
    const availablePositionSlots = whole(value.available_position_slots, "available_position_slots", U32);
    if (livePositions > positionCapacity || availablePositionSlots !== positionCapacity - livePositions) {
        throw new RangeError("invalid available_position_slots");
    }
    for (const validator of value.validators) {
        checkedValidator(validator);
    }
    return document;
}
function checkedValidatorDetail(value) {
    const document = value;
    if (!isRecord(value) || value.api_version !== 1) {
        throw new TypeError("invalid validator detail");
    }
    whole(value.finalized_height, "finalized_height");
    checkedValidator(value.validator);
    if (value.self_bond !== null) {
        checkedStakePosition(value.self_bond);
        const validator = value.validator;
        if (value.self_bond.kind !== "self_bond" || value.self_bond.validator_id !== validator.validator_id) {
            throw new TypeError("invalid validator self_bond");
        }
    }
    return document;
}
function checkedValidatorSlashStatus(value, expectedId) {
    const document = value;
    if (!isRecord(value) || value.api_version !== 1) {
        throw new TypeError("invalid validator slash status");
    }
    whole(value.finalized_height, "finalized_height");
    if (hash384(value.validator_id, "validator_id") !== expectedId) {
        throw new TypeError("invalid validator slash status id");
    }
    if (value.active_forfeiture === null) {
        return document;
    }
    const forfeiture = value.active_forfeiture;
    if (!isRecord(forfeiture)) {
        throw new TypeError("invalid validator slash forfeiture");
    }
    hash384(forfeiture.self_bond_position_id, "self_bond_position_id");
    hash384(forfeiture.evidence_id, "evidence_id");
    whole(forfeiture.evidence_height, "evidence_height");
    whole(forfeiture.applied_height, "applied_height");
    whole(forfeiture.retire_height, "retire_height");
    whole(forfeiture.position_count, "position_count", U32);
    atom(forfeiture.burned_principal, "burned_principal");
    return document;
}
function checkedValidatorUptimeList(value) {
    const document = value;
    if (!isRecord(value) || value.api_version !== 1 || !Array.isArray(value.validators)) {
        throw new TypeError("invalid validator uptime list");
    }
    const finalizedHeight = whole(value.finalized_height, "finalized_height");
    const fromHeight = whole(value.from_height, "from_height");
    const cuts = whole(value.cuts, "cuts", U32);
    const interval = whole(value.target_cut_interval_millis, "target_cut_interval_millis", U32);
    if (interval === 0) {
        throw new RangeError("target_cut_interval_millis must be greater than zero");
    }
    if (fromHeight > finalizedHeight || cuts > finalizedHeight) {
        throw new RangeError("invalid validator uptime range");
    }
    if (cuts > 0 && fromHeight !== finalizedHeight - cuts + 1) {
        throw new RangeError("invalid validator uptime range");
    }
    const validatorIds = new Set();
    for (const uptime of value.validators) {
        if (!isRecord(uptime)) {
            throw new TypeError("invalid validator uptime");
        }
        const validatorId = hash384(uptime.validator_id, "validator_id");
        if (validatorIds.has(validatorId)) {
            throw new TypeError("duplicate validator uptime");
        }
        validatorIds.add(validatorId);
        const committeeCuts = whole(uptime.committee_cuts, "committee_cuts", U32);
        const signedCuts = whole(uptime.signed_cuts, "signed_cuts", U32);
        if (committeeCuts > cuts || signedCuts > committeeCuts) {
            throw new RangeError("invalid validator uptime cuts");
        }
        const firstSignedHeight = nullableWhole(uptime.first_signed_height, "first_signed_height");
        const lastSignedHeight = nullableWhole(uptime.last_signed_height, "last_signed_height");
        if (signedCuts === 0 && (firstSignedHeight !== null || lastSignedHeight !== null)) {
            throw new TypeError("invalid validator uptime signed heights");
        }
        if (signedCuts > 0) {
            if (firstSignedHeight === null || lastSignedHeight === null) {
                throw new TypeError("invalid validator uptime signed heights");
            }
            if (firstSignedHeight > lastSignedHeight ||
                firstSignedHeight < fromHeight ||
                lastSignedHeight > finalizedHeight) {
                throw new RangeError("invalid validator uptime signed heights");
            }
        }
    }
    return document;
}
function checkedValidator(value) {
    if (!isRecord(value)) {
        throw new TypeError("invalid validator");
    }
    const state = validatorState(value.state);
    hash384(value.validator_id, "validator_id");
    address(value.owner_address);
    whole(value.owner_nonce, "owner_nonce");
    const exitRequestHeight = nullableWhole(value.exit_request_height, "exit_request_height");
    if ((state === "exit_requested") !== (exitRequestHeight !== null)) {
        throw new TypeError("invalid validator exit_request_height");
    }
    hash384(value.self_bond_position_id, "self_bond_position_id");
    const positionCapacity = capacity(value.position_capacity, "position_capacity");
    const livePositions = whole(value.live_positions, "live_positions", U32);
    const availablePositionSlots = whole(value.available_position_slots, "available_position_slots", U32);
    if (livePositions > positionCapacity || availablePositionSlots !== positionCapacity - livePositions) {
        throw new RangeError("invalid validator available_position_slots");
    }
    if (typeof value.accepting_delegations !== "boolean") {
        throw new TypeError("invalid validator accepting_delegations");
    }
    if (value.accepting_delegations !== (state === "eligible" && livePositions < positionCapacity)) {
        throw new TypeError("invalid validator accepting_delegations");
    }
    if (typeof value.consensus_public_key !== "string" ||
        value.consensus_public_key.length !== MLDSA65_PUBLIC_KEY_HEX_LENGTH) {
        throw new TypeError("invalid validator consensus public key");
    }
    hex(value.consensus_public_key, "consensus_public_key");
    whole(value.consensus_key_version, "consensus_key_version");
    overlayEndpoint(value.overlay_endpoint_hex, "overlay_endpoint_hex");
    pendingEndpoint(value.pending_endpoint);
    commissionBps(value.commission_bps, "commission_bps");
    pendingCommission(value.pending_commission);
    whole(value.last_heartbeat_epoch, "last_heartbeat_epoch");
    whole(value.activation_epoch, "activation_epoch");
    whole(value.activation_height, "activation_height");
    nullableWhole(value.last_attendance_epoch, "last_attendance_epoch");
    nullableWhole(value.jailed_until_epoch, "jailed_until_epoch");
    whole(value.penalty_generation, "penalty_generation");
    nullableWhole(value.pending_key_activation_epoch, "pending_key_activation_epoch");
    if (typeof value.is_active !== "boolean") {
        throw new TypeError("invalid validator is_active");
    }
    if (!Array.isArray(value.inactive_reasons)) {
        throw new TypeError("invalid validator inactive_reasons");
    }
    let previous = -1;
    for (const rawReason of value.inactive_reasons) {
        const reason = validatorInactiveReason(rawReason);
        const index = VALIDATOR_INACTIVE_REASON_ORDER.indexOf(reason);
        if (index <= previous) {
            throw new TypeError("invalid validator inactive_reasons");
        }
        previous = index;
    }
    if (value.is_active !== (value.inactive_reasons.length === 0)) {
        throw new TypeError("invalid validator is_active");
    }
}
function commissionBps(value, name) {
    const bps = whole(value, name, MAX_VALIDATOR_COMMISSION_BPS);
    if (bps < MIN_VALIDATOR_COMMISSION_BPS || bps % VALIDATOR_COMMISSION_STEP_BPS !== 0) {
        throw new RangeError(`${name} must be in ${VALIDATOR_COMMISSION_STEP_BPS}-bps steps from ${MIN_VALIDATOR_COMMISSION_BPS} to ${MAX_VALIDATOR_COMMISSION_BPS}`);
    }
}
function pendingCommission(value) {
    if (value === null) {
        return;
    }
    if (!isRecord(value)) {
        throw new TypeError("invalid validator pending_commission");
    }
    commissionBps(value.bps, "pending_commission.bps");
    whole(value.activate_after_epoch, "pending_commission.activate_after_epoch");
    whole(value.activate_after_height, "pending_commission.activate_after_height");
}
function pendingEndpoint(value) {
    if (value === null) {
        return;
    }
    if (!isRecord(value)) {
        throw new TypeError("invalid validator pending_endpoint");
    }
    overlayEndpoint(value.overlay_endpoint_hex, "pending_endpoint.overlay_endpoint_hex");
    whole(value.activate_after_epoch, "pending_endpoint.activate_after_epoch");
    whole(value.activate_after_height, "pending_endpoint.activate_after_height");
}
function overlayEndpoint(value, name) {
    const endpoint = hex(value, name);
    if (endpoint.length > MAX_VALIDATOR_OVERLAY_ENDPOINT_HEX_LENGTH) {
        throw new RangeError(`${name} exceeds the validator overlay endpoint limit`);
    }
}
function checkedStakePositionDetail(value, expectedId) {
    const document = value;
    if (!isRecord(value) || value.api_version !== 1) {
        throw new TypeError("invalid stake position detail");
    }
    whole(value.finalized_height, "finalized_height");
    checkedStakePosition(value.position);
    if (value.position.position_id !== expectedId) {
        throw new TypeError("invalid stake position id");
    }
    return document;
}
function checkedStakePositionList(value) {
    const document = value;
    if (!isRecord(value) || value.api_version !== 1 || !Array.isArray(value.positions)) {
        throw new TypeError("invalid stake position list");
    }
    whole(value.finalized_height, "finalized_height");
    for (const position of value.positions) {
        checkedStakePosition(position);
    }
    return document;
}
function checkedValidatorPositionList(value, expectedValidatorId) {
    const document = value;
    if (!isRecord(value) || value.api_version !== 1 || !Array.isArray(value.positions)) {
        throw new TypeError("invalid validator position list");
    }
    whole(value.finalized_height, "finalized_height");
    const validatorId = hash384(value.validator_id, "validator_id");
    if (validatorId !== expectedValidatorId) {
        throw new TypeError("invalid validator position list id");
    }
    atom(value.total_bonded, "total_bonded");
    atom(value.self_bonded, "self_bonded");
    atom(value.delegated, "delegated");
    whole(value.stakers, "stakers", U32);
    const positionCapacity = capacity(value.position_capacity, "position_capacity");
    const livePositions = whole(value.live_positions, "live_positions", U32);
    const availablePositionSlots = whole(value.available_position_slots, "available_position_slots", U32);
    if (livePositions > positionCapacity || availablePositionSlots !== positionCapacity - livePositions) {
        throw new RangeError("invalid validator position available_position_slots");
    }
    if (value.positions.length > livePositions) {
        throw new RangeError("invalid validator position page");
    }
    for (const position of value.positions) {
        checkedStakePosition(position);
        if (position.validator_id !== validatorId) {
            throw new TypeError("invalid validator position validator_id");
        }
    }
    return document;
}
function checkedStakePosition(value) {
    if (!isRecord(value)) {
        throw new TypeError("invalid stake position");
    }
    hash384(value.position_id, "position_id");
    hash384(value.validator_id, "validator_id");
    address(value.owner_address);
    address(value.reward_address);
    positiveAtom(value.principal, "principal");
    whole(value.position_nonce, "position_nonce");
    if (value.kind !== "self_bond" && value.kind !== "delegated") {
        throw new TypeError("invalid stake position kind");
    }
    if (value.state !== "bonded" && value.state !== "exit_requested" && value.state !== "unbonding" && value.state !== "withdrawable") {
        throw new TypeError("invalid stake position state");
    }
    if (typeof value.future_rewards_eligible !== "boolean" || value.future_rewards_eligible !== (value.state === "bonded")) {
        throw new TypeError("invalid stake position future_rewards_eligible");
    }
    nullableWhole(value.exit_request_height, "exit_request_height");
    nullableWhole(value.withdrawable_after_height, "withdrawable_after_height");
    nullableWhole(value.cuts_until_withdrawable, "cuts_until_withdrawable");
    nullableWhole(value.estimated_millis_until_withdrawable, "estimated_millis_until_withdrawable");
}
function atom(value, name) {
    parseAtoms(value);
}
function positiveAtom(value, name) {
    if (parseAtoms(value) === 0n) {
        throw new RangeError(`${name} must be greater than zero`);
    }
}
function capacity(value, name) {
    const result = whole(value, name, U32);
    if (result === 0) {
        throw new RangeError(`${name} must be greater than zero`);
    }
    return result;
}
function nullableWhole(value, name) {
    if (value !== null) {
        return whole(value, name);
    }
    return null;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
