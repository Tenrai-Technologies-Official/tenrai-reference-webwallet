/** Who registers, which coins pay it, the fee, its cap and the change: what a review shows and a signature keeps. The
 *  funding transaction and its validity come from the head the registration is signed at. */
export function sameRegistration(a, b) {
    return a.owner === b.owner && a.changeAddress === b.changeAddress && a.feeAtoms === b.feeAtoms
        && a.maximumFeeAtoms === b.maximumFeeAtoms && a.changeAtoms === b.changeAtoms && a.inputs.length === b.inputs.length
        && a.inputs.every((input, index) => input.transactionId === b.inputs[index]?.transactionId
            && input.outputIndex === b.inputs[index]?.outputIndex && input.amountAtoms === b.inputs[index]?.amountAtoms);
}
const HASH = /^[0-9a-f]{96}$/;
const ATOMS = /^(0|[1-9][0-9]{0,38})$/;
const MAX = (1n << 128n) - 1n;
function invalid() { throw new TypeError("Invalid paid private-registration plan or frame metadata."); }
function atoms(value) {
    if (typeof value !== "string" || !ATOMS.test(value) || BigInt(value) > MAX)
        invalid();
    return value;
}
function height(value) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
        invalid();
    return value;
}
function hash(value) { if (typeof value !== "string" || !HASH.test(value))
    invalid(); return value; }
export function registrationMetadata(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        invalid();
    const row = value;
    if (!Array.isArray(row.inputAmountAtoms) || !row.inputAmountAtoms.length || row.inputAmountAtoms.length > 8)
        invalid();
    const maximumFeeAtoms = atoms(row.maximumFeeAtoms);
    if (BigInt(maximumFeeAtoms) === 0n)
        invalid();
    return { frameId: hash(row.frameId), maximumFeeAtoms, inputAmountAtoms: row.inputAmountAtoms.map((value) => {
            const amount = atoms(value);
            if (BigInt(amount) === 0n)
                invalid();
            return amount;
        }) };
}
export function registrationInspectionMetadata(entry) {
    const metadata = registrationMetadata(entry.registration);
    return JSON.stringify({ input_amount_atoms: metadata.inputAmountAtoms, maximum_fee_atoms: metadata.maximumFeeAtoms });
}
export function registrationRequest(request, available, account) {
    if (typeof request.maximumFeeAtoms !== "bigint" || request.maximumFeeAtoms <= 0n || request.maximumFeeAtoms > MAX
        || !request.change || !["receive", "change"].includes(request.change.branch)
        || !Number.isSafeInteger(request.change.index) || request.change.index < 0 || request.change.index > 0x7fff_ffff)
        invalid();
    const coins = request.coins ? [...request.coins] : [...available].sort((a, b) => {
        if (a.amount !== b.amount)
            return a.amount > b.amount ? -1 : 1;
        return a.transactionId === b.transactionId ? a.outputIndex - b.outputIndex : a.transactionId < b.transactionId ? -1 : 1;
    });
    const selected = [];
    let total = 0n;
    for (const coin of coins) {
        selected.push(coin);
        total += coin.amount;
        if (request.coins === undefined && (total > request.maximumFeeAtoms || selected.length === 8))
            break;
    }
    if (!selected.length || selected.length > 8)
        throw new RangeError("Choose one to eight spendable registration inputs.");
    const allowed = new Map(available.map((coin) => [`${coin.transactionId}:${coin.outputIndex}`, coin]));
    for (const coin of selected) {
        const found = allowed.get(`${coin.transactionId}:${coin.outputIndex}`);
        if (!found || found.amount !== coin.amount || found.branch !== coin.branch || found.index !== coin.index)
            throw new Error("A selected registration input is unavailable or reserved.");
    }
    return JSON.stringify({ maximum_fee_atoms: request.maximumFeeAtoms.toString(),
        change: { account: String(account), branch: request.change.branch, index: String(request.change.index) },
        ...(request.ownerAuthorization === undefined ? {} : { owner_authorization: request.ownerAuthorization }),
        coins: selected.map((coin) => ({ transaction_id: coin.transactionId, output_index: String(coin.outputIndex), amount: coin.amount.toString(),
            account: String(account), branch: coin.branch, index: String(coin.index) })) });
}
export function registrationQuote(text) {
    if (typeof text !== "string" || text.length > 64 * 1024)
        invalid();
    const row = JSON.parse(text);
    if (row.kind !== "private_register" || row.route !== "registrations" || row.digest !== row.funding_transaction_id
        || !Array.isArray(row.inputs) || row.inputs.length < 1 || row.inputs.length > 8
        || !Array.isArray(row.input_amount_atoms) || row.input_amount_atoms.length !== row.inputs.length
        || !Array.isArray(row.sources) || row.sources.length !== 0 || typeof row.owner !== "string" || typeof row.change_address !== "string")
        invalid();
    const feeAtoms = BigInt(atoms(row.fee_atoms)), maximumFeeAtoms = BigInt(atoms(row.maximum_fee_atoms));
    if (maximumFeeAtoms === 0n || feeAtoms > maximumFeeAtoms || row.valid_until_height <= row.anchor_height)
        invalid();
    const inputs = row.inputs.map((input, index) => ({ transactionId: hash(input.transaction_id), outputIndex: height(input.output_index), amountAtoms: BigInt(atoms(row.input_amount_atoms[index])) }));
    if (inputs.some((input) => input.outputIndex > 0xffff_ffff || input.amountAtoms === 0n) || new Set(inputs.map((input) => `${input.transactionId}:${input.outputIndex}`)).size !== inputs.length)
        invalid();
    return Object.freeze({ transactionId: hash(row.digest), owner: row.owner, authorizationId: hash(row.authorization_id), feeAtoms, maximumFeeAtoms,
        changeAtoms: BigInt(atoms(row.change_atoms)), changeAddress: row.change_address, anchorHeight: height(row.anchor_height), validUntil: height(row.valid_until_height),
        inputs: Object.freeze(inputs.map((input) => Object.freeze(input))) });
}
