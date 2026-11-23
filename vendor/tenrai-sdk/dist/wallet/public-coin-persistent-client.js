import { PublicCoinOperations, publicCoinBudget, publicCoinKey, publicCoinQuery, publicLargestCoinQuery, publicCoinCursor } from "./public-coin-store.js";
import { commitPlan, decoded, document, mutations, progress, recoverPlan, resetPlan, scope } from "./public-coin-persistent-core.js";
function* action(value) {
    return yield value;
}
/** Hold one physical lease and publish balances after scan completion. */
export class PersistentCoins {
    #scope;
    #maximum;
    #transport;
    #operations;
    #checkpoint;
    #codec;
    constructor(namespace, transport, options) {
        this.#scope = scope(namespace);
        this.#maximum = publicCoinBudget(options);
        this.#transport = transport;
        this.#operations = new PublicCoinOperations(() => transport.close());
    }
    #context() {
        if (!this.#checkpoint || !this.#codec)
            throw new Error("Recover or reset the persistent public coin generation before reading it.");
        return { checkpoint: this.#checkpoint, codec: this.#codec };
    }
    #checkCodec(codec) {
        if (codec.scope !== this.#scope)
            throw new Error("Wrong persistent public coin codec scope.");
    }
    async #collect(generation) {
        for (;;) {
            const count = await this.#transport.collect(generation);
            if (!Number.isSafeInteger(count) || count < 0 || count > 256)
                throw new Error("Unbounded public coin collection response.");
            if (count === 0)
                return;
        }
    }
    async recover(codec) {
        this.#operations.snapshot(() => this.#checkCodec(codec));
        return this.#operations.run(async () => {
            if (this.#checkpoint === undefined) {
                const result = await this.#transport.run(recoverPlan(this.#scope, codec), false);
                this.#checkpoint = result === null ? null : document(result);
                this.#codec = codec;
                if (this.#checkpoint) {
                    if (this.#checkpoint.coinCount > this.#maximum)
                        throw new Error("Recovered public coins exceed the configured capacity.");
                    await this.#collect(this.#checkpoint.generation);
                }
            }
            return this.#checkpoint === null ? null : document(this.#checkpoint);
        });
    }
    async reset(next, codec) {
        const value = this.#operations.snapshot(() => { this.#checkCodec(codec); return progress(next); });
        return this.#operations.run(async () => {
            const checkpoint = document(await this.#transport.run(resetPlan(this.#scope, value, codec), true));
            this.#checkpoint = checkpoint;
            this.#codec = codec;
            await this.#collect(checkpoint.generation);
            return document(checkpoint);
        });
    }
    async commitPage(values, next, codec) {
        const checked = this.#operations.snapshot(() => { this.#checkCodec(codec); return { values: mutations(values), progress: progress(next) }; });
        return this.#operations.run(async () => {
            const { checkpoint } = this.#context();
            const result = document(await this.#transport.run(commitPlan(this.#scope, checkpoint, checked.values, checked.progress, codec, this.#maximum), true));
            this.#checkpoint = result;
            this.#codec = codec;
            return document(result);
        });
    }
    async get(key) {
        const checked = this.#operations.snapshot(() => publicCoinKey(key));
        return this.#operations.run(async () => {
            const { checkpoint, codec } = this.#context();
            const row = await this.#transport.run(action({ kind: "coinGet", generation: checkpoint.generation, key: checked }), false);
            return row === null ? null : decoded(row, this.#scope, checkpoint.generation, codec);
        });
    }
    async page(query = {}) {
        const checked = this.#operations.snapshot(() => publicCoinQuery(query));
        return this.#operations.run(async () => {
            const { checkpoint, codec } = this.#context();
            const rows = await this.#transport.run(action({ kind: "select", generation: checkpoint.generation, query: checked, largest: false }), false);
            if (!Array.isArray(rows) || rows.length > checked.limit + 1)
                throw new Error("Oversized persistent public coin selection.");
            let previous = checked.after;
            const all = rows.map((row) => {
                const coin = decoded(row, this.#scope, checkpoint.generation, codec), key = publicCoinCursor(coin);
                if (checked.address !== undefined && coin.address !== checked.address || previous !== undefined && key <= previous)
                    throw new Error("Malformed persistent public coin page order.");
                previous = key;
                return coin;
            });
            const coins = all.slice(0, checked.limit);
            return { coins, nextAfter: all.length > checked.limit ? publicCoinCursor(coins[coins.length - 1]) : null };
        });
    }
    async largestPage(query = {}) {
        const checked = this.#operations.snapshot(() => publicLargestCoinQuery(query));
        return this.#operations.run(async () => {
            const { checkpoint, codec } = this.#context();
            const rows = await this.#transport.run(action({ kind: "select", generation: checkpoint.generation, query: checked, largest: true }), false);
            if (!Array.isArray(rows) || rows.length > checked.limit + 1)
                throw new Error("Oversized persistent public coin amount selection.");
            let previous = checked.after;
            const all = rows.map((row) => {
                const coin = decoded(row, this.#scope, checkpoint.generation, codec), key = publicCoinCursor(coin);
                if (checked.address !== undefined && coin.address !== checked.address || previous && (coin.amount > previous.amount || coin.amount === previous.amount && key <= previous.key))
                    throw new Error("Malformed persistent public coin amount order.");
                previous = { amount: coin.amount, key };
                return coin;
            });
            const coins = all.slice(0, checked.limit), last = coins[coins.length - 1];
            return { coins, nextAfter: all.length > checked.limit && last ? { amount: last.amount, key: publicCoinCursor(last) } : null };
        });
    }
    close() {
        return this.#operations.close();
    }
}
