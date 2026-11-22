import { hash384, hex, whole, U32 } from "../validate.js";
const MAX_PROOF_HEX = 101_252;
function object(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new TypeError("invalid UTXO presence evidence");
    return value;
}
function fixed(value, length) {
    if (typeof value !== "string" || value.length !== length)
        throw new TypeError("invalid UTXO presence hexadecimal width");
    return hex(value, "UTXO presence evidence");
}
function point(value) {
    const row = object(value);
    return { transaction_id: hash384(row.transaction_id, "transaction_id"),
        output_index: whole(row.output_index, "output_index", U32) };
}
function cut(value) {
    const row = object(value);
    return { height: whole(row.height, "anchor.height"),
        cut_id: hash384(row.cut_id, "cut_id"), state_root: hash384(row.state_root, "state_root"),
        validator_set_id: hash384(row.validator_set_id, "validator_set_id") };
}
export function utxoPresenceRequest(anchor, points) {
    if (!Array.isArray(points) || points.length < 1 || points.length > 8)
        throw new RangeError("pass one to eight exact outpoints");
    const outpoints = points.map(point).sort((a, b) => a.transaction_id === b.transaction_id ? a.output_index - b.output_index : a.transaction_id < b.transaction_id ? -1 : 1);
    for (let i = 1; i < outpoints.length; i++)
        if (JSON.stringify(outpoints[i]) === JSON.stringify(outpoints[i - 1]))
            throw new RangeError("duplicate presence outpoint");
    return { api_version: 1, anchor: cut(anchor), outpoints };
}
/** Structural binding only. The protocol verifier must check every proof at a certified head. */
export function checkedUtxoPresenceResponse(value, request) {
    const row = object(value);
    const anchor = cut(row.anchor);
    if (row.api_version !== 1 || JSON.stringify(anchor) !== JSON.stringify(request.anchor) || !Array.isArray(row.proofs)
        || row.proofs.length !== request.outpoints.length || row.proofs.length < 1 || row.proofs.length > 8)
        throw new TypeError("incomplete or changed UTXO presence anchor");
    const network = row.network;
    if (network !== "mainnet" && network !== "testnet" && network !== "testnet100" && network !== "development")
        throw new TypeError("invalid presence network");
    const proofs = row.proofs.map((value, index) => {
        const proof = object(value);
        const outpoint = point(proof.outpoint);
        if (JSON.stringify(outpoint) !== JSON.stringify(request.outpoints[index]) || !Object.prototype.hasOwnProperty.call(proof, "record"))
            throw new TypeError("UTXO presence coverage changed");
        const record = proof.record === null ? null : fixed(proof.record, 236);
        if (typeof proof.proof !== "string" || proof.proof.length < 8 || proof.proof.length > MAX_PROOF_HEX)
            throw new RangeError("UTXO presence proof exceeds its bound");
        return { outpoint, record, proof: hex(proof.proof, "UTXO presence proof") };
    });
    return { api_version: 1, network, chain_id: hash384(row.chain_id, "chain_id"), anchor,
        state_commitment: fixed(row.state_commitment, 1684), proofs };
}
