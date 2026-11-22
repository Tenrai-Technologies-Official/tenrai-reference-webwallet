import type { CallOptions, Transport } from "../http.ts";
import type { FinalityBridge, FinalizedCutProofAnswer, PrivateAnchor, PrivateCutItems, PrivateNotePage, PrivateNullifierPage, PrivateNullifierKeyPage, PrivateNullifierUpdate, PrivateRecordPage, PrivateStatement, PrivateStatementList, PrivateSubmissionReceipt, PrivateTransferStatus } from "../types/private.ts";
/** The most notes, records or nullifiers one page returns. */
export declare const MAX_PRIVATE_PAGE = 512;
export interface PrivatePageOptions extends CallOptions {
    /** The first leaf or record index; pass the previous page's `next`. */
    from?: number;
    limit?: number;
}
export interface PrivateNullifierOptions extends CallOptions {
    /** The first height; pass the previous page's `next_height`. */
    fromHeight?: number;
    limit?: number;
}
export interface PrivateNullifierKeyOptions extends CallOptions {
    atHeight: number;
    /** The previous page's next cursor; an empty page may still advance it. */
    after?: string;
    limit?: number;
}
export interface PrivateNullifierUpdateOptions extends CallOptions {
    fromHeight: number;
    atHeight: number;
    /** The root the client's spends so far lead to. */
    root: string;
}
export declare class PrivateTransfersApi {
    #private;
    /** @internal */
    constructor(http: Transport);
    /**
     * `GET /v1/private/status`: whether private transfers (TSP-2) are active, the proof protocol the
     * node verifies, the limits and fee rule, the private state and the node's pool.
     */
    status(options?: CallOptions): Promise<PrivateTransferStatus>;
    /** `GET /v1/private/anchor`: the finalized head as the anchor of the next private statements. */
    anchor(options?: CallOptions): Promise<PrivateAnchor>;
    /**
     * `GET /v1/private/notes`: the finalized note log from `from` on, in leaf order. A node that does
     * not hold the notes from there, as before the height it synced from, answers 404.
     */
    notes(options?: PrivatePageOptions): Promise<PrivateNotePage>;
    /** `GET /v1/private/records`: the finalized recipient record log from `from` on, in index order. */
    records(options?: PrivatePageOptions): Promise<PrivateRecordPage>;
    /**
     * `GET /v1/private/nullifiers`: the nullifiers of whole finalized cuts from `fromHeight` on. A
     * wallet marks its notes spent from them locally; a node that does not hold the cuts from there
     * answers 404.
     */
    nullifiers(options?: PrivateNullifierOptions): Promise<PrivateNullifierPage>;
    /** Streams public hashed keys at one certified height; the wallet verifies the complete root. */
    nullifierKeys(options: PrivateNullifierKeyOptions): Promise<PrivateNullifierKeyPage>;
    /**
     * `GET /v1/private/nullifier-updates`: the next nullifiers with the nodes that prove them on top
     * of `root`. The wallet inserts them itself and compares the result with the root of a finalized
     * cut, so a node can hide no spend, and learns nothing about the wallet's notes. Answers 404 when
     * the node cannot prove them from there; then every row of `nullifiers` must do.
     */
    nullifierUpdate(options: PrivateNullifierUpdateOptions): Promise<PrivateNullifierUpdate>;
    /**
     * `GET /v1/finality/bridge`: the certified bridge that continues from this epoch end, given as its
     * finalized head record. A client verifies it from its own last anchor; 404 when the node holds
     * none yet.
     */
    finalityBridge(after: string, options?: CallOptions & {
        maxLinks?: number;
    }): Promise<FinalityBridge>;
    /**
     * `GET /v1/finality/cuts/{height}`: the cut at `height`, the quorum that finalized it and the proof
     * of its committee, for a client to verify from the epoch end before it.
     */
    finalizedCutProof(height: number, options?: CallOptions): Promise<FinalizedCutProofAnswer>;
    /**
     * `GET /v1/private/statements/{digest}`: one private statement as anyone may see it, executed or
     * waiting in the node's pool; 404 when the node knows none with this digest.
     */
    statement(digest: string, options?: CallOptions): Promise<PrivateStatement>;
    /**
     * `GET /v1/private/statements`: private statements, newest first: those waiting in the node's pool
     * on the first page, then what finalized cuts ran, whole cuts at a time. `next_before` asks for the next page.
     */
    statements(query?: {
        before?: number;
        limit?: number;
    }, options?: CallOptions): Promise<PrivateStatementList>;
    /**
     * `GET /v1/private/cuts/{height}`: the private items a finalized cut ran, in execution order; 404
     * where the node does not hold that cut's history.
     */
    cutItems(height: number, options?: CallOptions): Promise<PrivateCutItems>;
    /** `POST /v1/private/registrations`: a complete paid recipient-registration frame; the receipt names its full frame ID. */
    submitRegistration(bytesHex: string, options?: CallOptions): Promise<PrivateSubmissionReceipt>;
    /** `POST /v1/private/transfers`: a proven private transfer; the receipt names its statement digest. */
    submitTransfer(bytesHex: string, options?: CallOptions): Promise<PrivateSubmissionReceipt>;
    /** `POST /v1/private/enters`: a proven ENTER frame with its signed transparent transaction. */
    submitEnter(bytesHex: string, options?: CallOptions): Promise<PrivateSubmissionReceipt>;
    /** `POST /v1/private/exits`: a proven EXIT frame. */
    submitExit(bytesHex: string, options?: CallOptions): Promise<PrivateSubmissionReceipt>;
}
