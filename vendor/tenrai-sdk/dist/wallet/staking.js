import { formatTrai } from "../amount.js";
import { TenraiWalletError } from "../errors.js";
import { DEFAULT_VALIDATOR_COMMISSION_BPS, MAX_VALIDATOR_COMMISSION_BPS, MIN_VALIDATOR_COMMISSION_BPS, VALIDATOR_COMMISSION_STEP_BPS, } from "../types/staking.js";
import { DEFAULT_VALIDATOR_CONSENSUS_KEY_INDEX, MIN_VALIDATOR_CONSENSUS_KEY_INDEX } from "./keychain.js";
import { toHex } from "./protocol.js";
const ID = /^[0-9a-f]{96}$/;
export async function bond(desk, client, request) {
    const validatorId = identifier(request.validatorId, "validatorId");
    if (typeof request.amount !== "bigint" || request.amount <= 0n) {
        throw new TenraiWalletError("the amount must be a positive bigint of atoms", "invalid");
    }
    const [validators, detail] = await Promise.all([
        client.staking.validators({ limit: 1 }),
        client.staking.validator(validatorId),
    ]);
    const minimum = BigInt(validators.minimum_delegation);
    if (request.amount < minimum) {
        throw new TenraiWalletError(`the stake is below the minimum of ${formatTrai(minimum)} TRAI`, "invalid", { minimum });
    }
    if (!detail.validator.accepting_delegations) {
        throw new TenraiWalletError("this validator is not accepting delegations", "rejected", {
            validatorId,
            state: detail.validator.state,
            availablePositionSlots: detail.validator.available_position_slots,
            exitRequestHeight: detail.validator.exit_request_height,
        });
    }
    const context = await desk.context(client, request);
    try {
        const owner = desk.owner(context, request.owner ?? desk.address(0));
        const operation = {
            type: "bond",
            data: { validator_id: validatorId, owner_address: owner.address, reward_address: owner.address, amount: request.amount.toString() },
        };
        return await desk.operate(client, context, {
            operation,
            authorities: { owner },
            reserved: request.amount,
        });
    }
    finally {
        await context.close();
    }
}
export async function registerValidator(desk, client, request) {
    if (typeof request.selfBond !== "bigint" || request.selfBond <= 0n) {
        throw new TenraiWalletError("selfBond must be a positive bigint of atoms", "invalid");
    }
    const overlayEndpointHex = checkedOverlayEndpointHex(request.overlayEndpointHex);
    const validators = await client.staking.validators({ limit: 1 });
    const context = await desk.context(client, request);
    try {
        const minimum = BigInt(validators.minimum_self_bond);
        if (request.selfBond < minimum) {
            throw new TenraiWalletError(`the self-bond is below the minimum of ${formatTrai(minimum)} TRAI`, "invalid", { minimum });
        }
        const owner = desk.owner(context, request.owner ?? desk.address(0));
        const rewardAddress = context.protocol.parseAddress(request.rewardAddress ?? owner.address);
        const commissionBps = checkedCommissionBps(request.commissionBps === undefined ? DEFAULT_VALIDATOR_COMMISSION_BPS : request.commissionBps);
        const possession = desk.validatorSigner(request.consensusKeyIndex === undefined ? DEFAULT_VALIDATOR_CONSENSUS_KEY_INDEX : request.consensusKeyIndex, "possession");
        return await desk.operate(client, context, {
            operation: {
                type: "register",
                data: {
                    consensus_public_key: toHex(possession.publicKey),
                    overlay_endpoint_hex: overlayEndpointHex,
                    owner_address: owner.address,
                    reward_address: rewardAddress,
                    self_bond: request.selfBond.toString(),
                    commission_bps: String(commissionBps),
                },
            },
            authorities: { owner, possession },
            reserved: request.selfBond,
        });
    }
    finally {
        await context.close();
    }
}
export async function exitValidator(desk, client, request) {
    const validatorId = identifier(request.validatorId, "validatorId");
    const detail = await client.staking.validator(validatorId);
    const context = await desk.context(client, request);
    try {
        const record = detail.validator;
        if (record.state !== "eligible") {
            throw new TenraiWalletError("this validator has already requested exit", "rejected", { validatorId, state: record.state });
        }
        const owner = desk.owner(context, record.owner_address);
        return await desk.operate(client, context, {
            operation: {
                type: "exit",
                data: { validator_id: validatorId, expected_owner_nonce: String(record.owner_nonce) },
            },
            authorities: { owner },
        });
    }
    finally {
        await context.close();
    }
}
export async function rotateValidator(desk, client, request) {
    const validatorId = identifier(request.validatorId, "validatorId");
    const overlayEndpointHex = checkedOverlayEndpointHex(request.overlayEndpointHex);
    const detail = await client.staking.validator(validatorId);
    const context = await desk.context(client, request);
    try {
        const record = detail.validator;
        if (record.state !== "eligible") {
            throw new TenraiWalletError("this validator cannot rotate after it requested exit", "rejected", { validatorId, state: record.state });
        }
        if (record.pending_key_activation_epoch !== null) {
            throw new TenraiWalletError("this validator already has a key rotation pending", "rejected", {
                validatorId,
                activationEpoch: record.pending_key_activation_epoch,
            });
        }
        if (record.pending_endpoint !== null) {
            throw new TenraiWalletError("this validator already has an endpoint change pending", "rejected", {
                validatorId,
                pending: record.pending_endpoint,
            });
        }
        const owner = desk.owner(context, record.owner_address);
        const possession = rotationSigner(desk, record.consensus_public_key, record.consensus_key_version, request.consensusKeyIndex);
        return await desk.operate(client, context, {
            operation: {
                type: "rotate",
                data: {
                    validator_id: validatorId,
                    expected_owner_nonce: String(record.owner_nonce),
                    new_consensus_public_key: toHex(possession.publicKey),
                    overlay_endpoint_hex: overlayEndpointHex,
                },
            },
            authorities: { owner, possession },
        });
    }
    finally {
        await context.close();
    }
}
export async function updateValidatorEndpoint(desk, client, request) {
    const validatorId = identifier(request.validatorId, "validatorId");
    const overlayEndpointHex = checkedOverlayEndpointHex(request.overlayEndpointHex);
    const detail = await client.staking.validator(validatorId);
    const context = await desk.context(client, request);
    try {
        const record = detail.validator;
        if (record.state !== "eligible") {
            throw new TenraiWalletError("this validator cannot change its endpoint after it requested exit", "rejected", {
                validatorId,
                state: record.state,
            });
        }
        if (record.pending_key_activation_epoch !== null) {
            throw new TenraiWalletError("this validator already has a key rotation pending", "rejected", {
                validatorId,
                activationEpoch: record.pending_key_activation_epoch,
            });
        }
        if (record.pending_endpoint !== null) {
            throw new TenraiWalletError("this validator already has an endpoint change pending", "rejected", {
                validatorId,
                pending: record.pending_endpoint,
            });
        }
        const owner = desk.owner(context, record.owner_address);
        const possession = activeValidatorSigner(desk, record.consensus_public_key, record.consensus_key_version, request.consensusKeyIndex, "possession");
        return await desk.operate(client, context, {
            operation: {
                type: "endpoint",
                data: {
                    validator_id: validatorId,
                    expected_owner_nonce: String(record.owner_nonce),
                    expected_consensus_key_version: String(record.consensus_key_version),
                    consensus_public_key: toHex(possession.publicKey),
                    overlay_endpoint_hex: overlayEndpointHex,
                },
            },
            authorities: { owner, possession },
        });
    }
    finally {
        await context.close();
    }
}
export async function scheduleValidatorCommission(desk, client, request) {
    const validatorId = identifier(request.validatorId, "validatorId");
    const commissionBps = checkedCommissionBps(request.commissionBps);
    const detail = await client.staking.validator(validatorId);
    const context = await desk.context(client, request);
    try {
        const record = detail.validator;
        if (record.state !== "eligible") {
            throw new TenraiWalletError("this validator cannot change commission after it requested exit", "rejected", {
                validatorId,
                state: record.state,
            });
        }
        if (record.commission_bps === commissionBps) {
            throw new TenraiWalletError("this commission is already active", "invalid", { validatorId, commissionBps });
        }
        if (record.pending_commission !== null) {
            throw new TenraiWalletError("this validator already has a commission change pending", "rejected", {
                validatorId,
                pending: record.pending_commission,
            });
        }
        const owner = desk.owner(context, record.owner_address);
        return await desk.operate(client, context, {
            operation: {
                type: "commission",
                data: {
                    validator_id: validatorId,
                    expected_owner_nonce: String(record.owner_nonce),
                    commission_bps: String(commissionBps),
                },
            },
            authorities: { owner },
        });
    }
    finally {
        await context.close();
    }
}
export async function setStakeRewardAddress(desk, client, request) {
    const positionId = identifier(request.positionId, "positionId");
    const detail = await client.staking.position(positionId);
    const context = await desk.context(client, request);
    try {
        const position = detail.position;
        const rewardAddress = context.protocol.parseAddress(request.rewardAddress);
        if (rewardAddress === position.reward_address) {
            throw new TenraiWalletError("the new reward address is already configured for this position", "invalid");
        }
        const owner = desk.owner(context, position.owner_address);
        return await desk.operate(client, context, {
            operation: {
                type: "reward_lock",
                data: {
                    position_id: positionId,
                    expected_position_nonce: String(position.position_nonce),
                    new_reward_address: rewardAddress,
                },
            },
            authorities: { owner },
        });
    }
    finally {
        await context.close();
    }
}
export async function heartbeatValidator(desk, client, request) {
    const validatorId = identifier(request.validatorId, "validatorId");
    const [detail, epoch] = await Promise.all([client.staking.validator(validatorId), client.chain.epoch()]);
    const context = await desk.context(client, request);
    try {
        const record = detail.validator;
        if (record.state !== "eligible") {
            throw new TenraiWalletError("this validator cannot publish a heartbeat after it requested exit", "rejected", {
                validatorId,
                state: record.state,
            });
        }
        if (epoch.epoch <= record.last_heartbeat_epoch) {
            throw new TenraiWalletError("this validator already has a heartbeat for the current epoch", "rejected", {
                validatorId,
                epoch: record.last_heartbeat_epoch,
            });
        }
        const validator = activeValidatorSigner(desk, record.consensus_public_key, record.consensus_key_version, request.consensusKeyIndex);
        return await desk.operate(client, context, {
            operation: {
                type: "heartbeat",
                data: {
                    validator_id: validatorId,
                    expected_consensus_key_version: String(record.consensus_key_version),
                    expected_heartbeat_epoch: String(record.last_heartbeat_epoch),
                },
            },
            authorities: { validator },
        });
    }
    finally {
        await context.close();
    }
}
export async function position(desk, client, request, kind) {
    const positionId = identifier(request.positionId, "positionId");
    const detail = await client.staking.position(positionId);
    const context = await desk.context(client, request);
    try {
        const { position } = detail;
        const owner = desk.owner(context, position.owner_address);
        if (kind === "unbond" && (position.state === "unbonding" || position.state === "withdrawable")) {
            throw new TenraiWalletError("the position is already unbonding", "invalid");
        }
        if (kind === "withdraw" && position.state !== "withdrawable") {
            throw new TenraiWalletError("the position is not withdrawable yet", "invalid");
        }
        const returned = kind === "withdraw" ? BigInt(position.principal) : 0n;
        return await desk.operate(client, context, {
            operation: {
                type: kind,
                data: { position_id: positionId, expected_position_nonce: String(position.position_nonce) },
            },
            authorities: { owner },
            released: returned,
        });
    }
    finally {
        await context.close();
    }
}
function rotationSigner(desk, activePublicKey, consensusKeyVersion, requestedIndex) {
    if (requestedIndex !== undefined) {
        const signer = desk.validatorSigner(requestedIndex, "possession");
        if (toHex(signer.publicKey) === activePublicKey) {
            throw new TenraiWalletError("the replacement consensus key is already active", "invalid");
        }
        return signer;
    }
    const index = DEFAULT_VALIDATOR_CONSENSUS_KEY_INDEX - consensusKeyVersion - 1;
    if (!Number.isSafeInteger(index) || index < MIN_VALIDATOR_CONSENSUS_KEY_INDEX) {
        throw new TenraiWalletError("the reserved validator key range is exhausted; pass consensusKeyIndex", "rejected");
    }
    const signer = desk.validatorSigner(index, "possession");
    if (toHex(signer.publicKey) === activePublicKey) {
        throw new TenraiWalletError("the default replacement consensus key is already active; pass consensusKeyIndex", "invalid");
    }
    return signer;
}
function activeValidatorSigner(desk, activePublicKey, consensusKeyVersion, requestedIndex, purpose = "validator") {
    if (requestedIndex !== undefined) {
        const signer = desk.validatorSigner(requestedIndex, purpose);
        if (toHex(signer.publicKey) !== activePublicKey) {
            throw new TenraiWalletError("consensusKeyIndex does not match the registered consensus key", "invalid");
        }
        return signer;
    }
    const index = DEFAULT_VALIDATOR_CONSENSUS_KEY_INDEX - consensusKeyVersion;
    if (!Number.isSafeInteger(index) || index < MIN_VALIDATOR_CONSENSUS_KEY_INDEX) {
        throw new TenraiWalletError("pass consensusKeyIndex for this validator key", "invalid");
    }
    const signer = desk.validatorSigner(index, purpose);
    if (toHex(signer.publicKey) !== activePublicKey) {
        throw new TenraiWalletError("pass consensusKeyIndex for this validator key", "invalid");
    }
    return signer;
}
function identifier(value, name) {
    if (typeof value !== "string" || !ID.test(value)) {
        throw new TenraiWalletError(`${name} must be 96 lowercase hex characters`, "invalid");
    }
    return value;
}
function checkedCommissionBps(value) {
    if (!Number.isSafeInteger(value) ||
        value < MIN_VALIDATOR_COMMISSION_BPS ||
        value > MAX_VALIDATOR_COMMISSION_BPS ||
        value % VALIDATOR_COMMISSION_STEP_BPS !== 0) {
        throw new TenraiWalletError(`commissionBps must be in ${VALIDATOR_COMMISSION_STEP_BPS}-bps steps from ${MIN_VALIDATOR_COMMISSION_BPS} to ${MAX_VALIDATOR_COMMISSION_BPS}`, "invalid");
    }
    return value;
}
function checkedOverlayEndpointHex(value) {
    if (typeof value !== "string" || !/^(?:[0-9a-f]{2})+$/.test(value) || value.length > 2_326) {
        throw new TenraiWalletError("overlayEndpointHex must be non-empty lowercase hex within the validator endpoint limit", "invalid");
    }
    return value;
}
