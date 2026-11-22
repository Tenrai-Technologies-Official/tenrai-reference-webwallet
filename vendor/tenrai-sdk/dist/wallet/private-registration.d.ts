import type { PrivateCoin } from "./private-notes.ts";
import type { PrivateSend } from "./private-sends.ts";
export interface PrivateRegistrationRequest {
    maximumFeeAtoms: bigint;
    change: {
        branch: "receive" | "change";
        index: number;
    };
    /** Explicit sponsor inputs; without them the quote chooses at most eight available coins. */
    coins?: PrivateCoin[];
    /** An exported owner's authorization when this wallet sponsors another private account. */
    ownerAuthorization?: string;
}
export interface PrivateRegistrationQuote {
    transactionId: string;
    owner: string;
    authorizationId: string;
    feeAtoms: bigint;
    maximumFeeAtoms: bigint;
    changeAtoms: bigint;
    changeAddress: string;
    anchorHeight: number;
    validUntil: number;
    inputs: ReadonlyArray<{
        transactionId: string;
        outputIndex: number;
        amountAtoms: bigint;
    }>;
}
export interface RegistrationMetadata {
    frameId: string;
    inputAmountAtoms: string[];
    maximumFeeAtoms: string;
}
/** Who registers, which coins pay it, the fee, its cap and the change: what a review shows and a signature keeps. The
 *  funding transaction and its validity come from the head the registration is signed at. */
export declare function sameRegistration(a: PrivateRegistrationQuote, b: PrivateRegistrationQuote): boolean;
export interface RegistrationSummary {
    kind: "private_register";
    route: "registrations";
    digest: string;
    funding_transaction_id: string;
    owner: string;
    authorization_id: string;
    owner_authorization: string;
    fee_atoms: string;
    maximum_fee_atoms: string;
    change_atoms: string;
    change_address: string;
    anchor_height: number;
    valid_until_height: number;
    inputs: {
        transaction_id: string;
        output_index: number;
    }[];
    input_amount_atoms: string[];
    sources: number[];
}
export declare function registrationMetadata(value: unknown): RegistrationMetadata;
export declare function registrationInspectionMetadata(entry: PrivateSend): string;
export declare function registrationRequest(request: PrivateRegistrationRequest, available: PrivateCoin[], account: number): string;
export declare function registrationQuote(text: string): PrivateRegistrationQuote;
