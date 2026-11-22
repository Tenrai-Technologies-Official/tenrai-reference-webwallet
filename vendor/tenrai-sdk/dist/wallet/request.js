import { formatTrai, parseTrai } from "../amount.js";
import { TenraiWalletError } from "../errors.js";
import { isSafeText } from "./payload.js";
import { protocolBindings } from "./runtime.js";
// The protocol's payment URI schemes; its URI takes no parameters, so the amount and payload are added on top.
const SCHEMES = { mainnet: "trai", testnet: "trai-test", testnet100: "trai-test", development: "trai-dev" };
const MAX_REQUEST_CHARS = 640;
const PARAMETERS = new Set(["amount", "payload"]);
// Letters, digits, spaces and a few signs: enough for an invoice number, nothing a web page could run.
const REQUEST_PAYLOAD = /^[\p{L}\p{M}\p{N} .,:;\-_/#+()!?%@*&]+$/u;
/** The most UTF-8 bytes a payment request's payload may hold, so its QR code stays easy to scan. */
export const MAX_REQUEST_PAYLOAD_BYTES = 128;
/** Letters, digits, spaces and `. , : ; - _ / # + ( ) ! ? % @ * &`, without outer spaces, up to 128 bytes. */
export function isRequestPayload(text) {
    return (typeof text === "string" &&
        text.trim() === text &&
        REQUEST_PAYLOAD.test(text) &&
        isSafeText(text) &&
        new TextEncoder().encode(text).length <= MAX_REQUEST_PAYLOAD_BYTES);
}
function requestPayload(text) {
    if (!isRequestPayload(text)) {
        throw new TenraiWalletError(`a requested payload holds letters, digits, spaces and . , : ; - _ / # + ( ) ! ? % @ * & only, up to ${MAX_REQUEST_PAYLOAD_BYTES} bytes`, "invalid");
    }
    return text;
}
/**
 * The payment URI of `address` for a QR code: `?amount=` in TRAI when an amount above zero is asked for,
 * `payload=` when a payload is, such as an invoice number the sender's wallet fills in.
 */
export async function paymentRequest(address, network, amount = 0n, payload = "") {
    if (!(network in SCHEMES) || typeof amount !== "bigint" || amount < 0n || typeof payload !== "string") {
        throw new TenraiWalletError("a payment request needs a network and an amount of zero or more atoms", "invalid");
    }
    const wasm = await protocolBindings();
    let checked;
    try {
        checked = wasm.parseAddress(address, network);
    }
    catch {
        throw new TenraiWalletError(`not a ${network} address`, "invalid");
    }
    const parameters = [
        ...(amount > 0n ? [`amount=${formatTrai(amount)}`] : []),
        ...(payload ? [`payload=${encodeURIComponent(requestPayload(payload))}`] : []),
    ];
    const uri = `${SCHEMES[network]}:${checked}`;
    return parameters.length ? `${uri}?${parameters.join("&")}` : uri;
}
/**
 * Reads what a QR code or a pasted text holds: an address, a payment URI, or a payment request with an
 * amount, a payload or both. Anything else, any other parameter or a parameter twice is refused.
 */
export async function parsePaymentRequest(text, network) {
    if (typeof text !== "string" || !(network in SCHEMES) || text.trim().length === 0 || text.trim().length > MAX_REQUEST_CHARS) {
        throw new TenraiWalletError("not an address or payment request", "invalid");
    }
    const value = text.trim();
    const query = value.indexOf("?");
    const base = query < 0 ? value : value.slice(0, query);
    const wasm = await protocolBindings();
    let address;
    try {
        const bare = base.includes(":") ? (wasm.parsePaymentUri(base, network).split(":")[1] ?? "") : base;
        address = wasm.parseAddress(bare, network);
    }
    catch {
        throw new TenraiWalletError(`not a ${network} address or payment URI`, "invalid");
    }
    if (query < 0) {
        return { address, amount: null, payload: null };
    }
    const parameters = [...new URLSearchParams(value.slice(query + 1))];
    const names = parameters.map(([name]) => name);
    if (!base.includes(":") || parameters.length === 0 || names.some((name) => !PARAMETERS.has(name)) || new Set(names).size !== names.length) {
        throw new TenraiWalletError("a payment request is a payment URI with an amount, a payload or both", "invalid");
    }
    const asked = new Map(parameters);
    let amount = null;
    const raw = asked.get("amount");
    if (raw !== undefined) {
        try {
            amount = parseTrai(raw);
        }
        catch {
            throw new TenraiWalletError("the requested amount is not a TRAI amount", "invalid");
        }
        if (amount === 0n) {
            throw new TenraiWalletError("the requested amount must be above zero", "invalid");
        }
    }
    const payload = asked.get("payload");
    return { address, amount, payload: payload === undefined ? null : requestPayload(payload) };
}
