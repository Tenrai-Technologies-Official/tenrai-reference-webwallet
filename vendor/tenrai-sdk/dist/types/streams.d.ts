import type { AddressChange } from "./address.ts";
import type { ChainRates } from "./chain.ts";
import type { ApiErrorDocument, ApiVersion, AtomAmount, FinalizedCut, Hash384Hex, RewardReference, StakePayoutReference } from "./common.ts";
import type { BlockSummary, CutSummary } from "./ledger.ts";
import type { MempoolTransaction, MempoolTransactionRemoved, MempoolTxRemoved, MempoolTxSeen } from "./mempool.ts";
import type { MempoolInfo, SyncStatus } from "./node.ts";
import type { TransactionStatus } from "./transaction.ts";
export type SocketTopic = "cuts" | "blocks" | "mempool" | "rates" | "sync" | "transaction" | "mempool_transactions" | "addresses";
export type SocketEvent = {
    type: "cut_finalized";
    data: CutSummary;
} | {
    type: "block_accepted";
    data: BlockSummary;
} | {
    type: "mempool";
    data: MempoolInfo;
} | {
    type: "rates";
    data: ChainRates;
} | {
    type: "sync";
    data: SyncStatus;
} | {
    type: "transaction_status";
    data: TransactionStatus;
} | {
    type: "address_changed";
    data: AddressChange;
} | {
    type: "mempool_tx_seen";
    data: MempoolTxSeen;
} | {
    type: "mempool_tx_removed";
    data: MempoolTxRemoved;
} | {
    type: "mempool_transaction";
    data: MempoolTransaction;
} | {
    type: "mempool_transaction_removed";
    data: MempoolTransactionRemoved;
};
/** The events each `/v1/ws` topic delivers. */
export interface TopicEvents {
    cuts: Extract<SocketEvent, {
        type: "cut_finalized";
    }>;
    blocks: Extract<SocketEvent, {
        type: "block_accepted";
    }>;
    mempool: Extract<SocketEvent, {
        type: "mempool";
    }>;
    rates: Extract<SocketEvent, {
        type: "rates";
    }>;
    sync: Extract<SocketEvent, {
        type: "sync";
    }>;
    transaction: Extract<SocketEvent, {
        type: "transaction_status";
    }>;
    addresses: Extract<SocketEvent, {
        type: "address_changed" | "mempool_tx_seen" | "mempool_tx_removed";
    }>;
    mempool_transactions: Extract<SocketEvent, {
        type: "mempool_transaction" | "mempool_transaction_removed";
    }>;
}
/**
 * `stream_lagged`: the client read too slowly. `stream_restarted`: the server's source restarted.
 * `history_unavailable`: `after_height` is older than the replay reaches.
 */
export type EventResyncReason = "stream_lagged" | "stream_restarted" | "history_unavailable";
export type ClientFrame = {
    type: "subscribe";
    data: {
        id: number;
        topic: SocketTopic;
        transaction_id?: Hash384Hex;
        addresses?: string[];
    };
} | {
    type: "unsubscribe";
    data: {
        id: number;
        subscription: number;
    };
} | {
    type: "request";
    data: {
        id: number;
        path: string;
    };
} | {
    type: "ping";
    data: {
        id: number;
    };
};
export type ServerFrame = {
    type: "response";
    data: {
        id: number;
        status: number;
        body: unknown;
    };
} | {
    type: "subscribed";
    data: {
        id: number;
        subscription: number;
        topic: SocketTopic;
    };
} | {
    type: "unsubscribed";
    data: {
        id: number;
        subscription: number;
    };
} | {
    type: "notification";
    data: {
        subscription: number;
        event: SocketEvent;
    };
} | {
    type: "resync_required";
    data: {
        subscription: number;
        reason: EventResyncReason;
    };
} | {
    type: "pong";
    data: {
        id: number;
    };
} | {
    type: "error";
    data: {
        id: number | null;
        error: ApiErrorDocument;
    };
};
export interface EventCheckpoint {
    api_version: ApiVersion;
    finalized: FinalizedCut;
}
export interface CutFinalizedEvent {
    api_version: ApiVersion;
    cut: FinalizedCut;
    registered_work: number;
    executed_work: number;
    rewards: RewardReference[];
    /** What the staking pool received from this cut; null in replays of older cuts. */
    stake_rewards: AtomAmount | null;
    /** Positions paid from a closed staking pool in this cut. */
    stake_payouts: StakePayoutReference[];
}
export type NodeEvent = {
    type: "checkpoint";
    data: EventCheckpoint;
} | {
    type: "cut_finalized";
    data: CutFinalizedEvent;
} | {
    type: "resync_required";
    data: {
        api_version: ApiVersion;
        reason: EventResyncReason;
    };
};
export type TransactionStatusFrame = {
    type: "snapshot";
    data: TransactionStatus;
} | {
    type: "update";
    data: TransactionStatus;
} | {
    type: "resync_required";
    data: {
        api_version: ApiVersion;
        transaction_id: Hash384Hex;
        reason: EventResyncReason;
    };
};
