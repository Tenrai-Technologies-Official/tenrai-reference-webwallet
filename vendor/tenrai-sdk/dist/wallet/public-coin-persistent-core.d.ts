import type { PublicCoinMutation } from "./public-coin-persistent-types.ts";
/** @param {any} value */
export declare function scope(value: any): string;
/** @param {any} value */
export declare function progress(value: any): string;
/** @param {any} value */
export declare function sealed(value: any): Uint8Array<ArrayBuffer>;
/** @param {any} value */
export declare function document(value: any): {
    generation: any;
    root: any;
    coinCount: any;
    totalAtoms: any;
    progress: string;
};
/** @param {any} a @param {any} b */
export declare function sameDocument(a: any, b: any): boolean;
/** @param {any} a @param {any} b */
export declare function sameBytes(a: any, b: any): boolean;
/** @param {any} codec @param {any} key */
export declare function bucket(codec: any, key: any): string;
/** @param {any} codec */
export declare function emptyHashes(codec: any): {
    b: string;
    m: string;
    t: string;
    root: string;
};
/** @param {any} coin @param {any} namespace @param {any} generation @param {any} codec */
export declare function stored(coin: any, namespace: any, generation: any, codec: any): {
    amount: string;
    scope: any;
    generation: any;
    key: string;
    bucket: string;
    inverseAmount: string;
    address: string;
    transactionId: string;
    outputIndex: number;
    height: number;
};
/** @param {any} row @param {any} namespace @param {any} generation @param {any} codec */
export declare function decoded(row: any, namespace: any, generation: any, codec: any): import("./public-coin-store.ts").PublicCoin;
/** @param {any} values */
export declare function mutations(values: any): PublicCoinMutation[];
/** @param {any} namespace @param {any} codec @returns {Generator<any,any,any>} */
export declare function recoverPlan(namespace: any, codec: any): Generator<any, any, any>;
/** @param {any} namespace @param {any} expected @param {any} values @param {any} nextProgress @param {any} codec @param {any} maximum @returns {Generator<any,any,any>} */
export declare function commitPlan(namespace: any, expected: any, values: any, nextProgress: any, codec: any, maximum: any): Generator<any, any, any>;
/** @param {any} namespace @param {any} nextProgress @param {any} codec @returns {Generator<any,any,any>} */
export declare function resetPlan(namespace: any, nextProgress: any, codec: any): Generator<any, any, any>;
