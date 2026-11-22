export type PublicReservationOwner = string | symbol;
export interface PublicReservationClaim {
    owner: string;
    keys: readonly string[];
    validUntil: bigint;
}
export declare class PublicReservations {
    #private;
    readonly privatelyHeld: (key: string) => boolean;
    constructor(privatelyHeld: (key: string) => boolean);
    get deadlines(): ReadonlyMap<string, bigint>;
    assertAvailable(points: readonly string[]): void;
    temporary(points: readonly string[], validUntil: bigint): symbol;
    claimOwned(artifact: string, points: readonly string[], validUntil: bigint): void;
    /** Complete preflight precedes every mutation, including recovery of a whole retained journal. */
    retainMany(claims: readonly PublicReservationClaim[]): void;
    assertOwned(artifact: PublicReservationOwner, points: readonly string[]): void;
    transfer(claim: symbol, artifact: string, points: readonly string[], validUntil: bigint): void;
    /** Only authenticated terminal reconciliation or the exact unsent batch owner may free a hold. */
    releaseOwned(artifact: PublicReservationOwner, points: readonly string[]): void;
}
