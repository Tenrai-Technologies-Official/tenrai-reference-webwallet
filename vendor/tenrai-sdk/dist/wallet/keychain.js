import { TenraiWalletError } from "../errors.js";
import { PUBLIC_KEY_BYTES } from "./protocol.js";
export const MIN_VALIDATOR_CONSENSUS_KEY_INDEX = 0x7fff_0000;
export const DEFAULT_VALIDATOR_CONSENSUS_KEY_INDEX = 0x7fff_ffff;
export const DEFAULT_VALIDATOR_ROTATION_KEY_INDEX = DEFAULT_VALIDATOR_CONSENSUS_KEY_INDEX - 1;
/** The keys of one account as far as they were derived; the secret parts stay in the WASM. */
export class KeyChain {
    #wasm;
    #network;
    #account;
    #root;
    #derived = new Map();
    #paths = new Map();
    constructor(wasm, root, network, account) {
        this.#wasm = wasm;
        this.#root = root;
        this.#network = network;
        this.#account = account;
    }
    root() {
        if (!this.#root) {
            throw new TenraiWalletError("the wallet is closed", "invalid");
        }
        return this.#root;
    }
    path(address) {
        return this.#paths.get(address);
    }
    key(branch, index) {
        if (!Number.isSafeInteger(index) || index < 0 || index >= 0x80000000) {
            throw new RangeError("address index must be from 0 to 2^31 - 1");
        }
        const path = `${branch}:${index}`;
        const known = this.#derived.get(path);
        if (known) {
            return known;
        }
        const publicKey = this.root().derivePublicKey(String(this.#account), branch, String(index));
        if (publicKey.length !== PUBLIC_KEY_BYTES) {
            throw new TenraiWalletError("the protocol package derived an invalid public key", "rejected");
        }
        const derived = { publicKey, address: this.#wasm.addressFromPublicKey(publicKey, this.#network) };
        this.#derived.set(path, derived);
        this.#paths.set(derived.address, { branch, index });
        return derived;
    }
    signer(address, purpose) {
        const path = this.#paths.get(address);
        if (!path) {
            throw new TenraiWalletError("the address belongs to no wallet path", "rejected");
        }
        const root = this.root();
        return {
            publicKey: this.key(path.branch, path.index).publicKey,
            sign: (message) => root.sign(String(this.#account), path.branch, String(path.index), message, purpose),
        };
    }
    validatorSigner(index, purpose) {
        if (!Number.isSafeInteger(index) ||
            index < MIN_VALIDATOR_CONSENSUS_KEY_INDEX ||
            index > DEFAULT_VALIDATOR_CONSENSUS_KEY_INDEX) {
            throw new TenraiWalletError(`validator consensus key index must be a whole number from ${MIN_VALIDATOR_CONSENSUS_KEY_INDEX} to ${DEFAULT_VALIDATOR_CONSENSUS_KEY_INDEX}`, "invalid");
        }
        const key = this.key("change", index);
        const root = this.root();
        return {
            publicKey: key.publicKey,
            sign: (message) => root.sign(String(this.#account), "change", String(index), message, purpose),
        };
    }
    close() {
        this.#root?.free();
        this.#root = undefined;
        for (const { publicKey } of this.#derived.values()) {
            publicKey.fill(0);
        }
        this.#derived.clear();
    }
}
