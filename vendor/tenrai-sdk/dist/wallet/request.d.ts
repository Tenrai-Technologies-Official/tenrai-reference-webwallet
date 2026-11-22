import type { Network } from "../types/common.ts";
/** The most UTF-8 bytes a payment request's payload may hold, so its QR code stays easy to scan. */
export declare const MAX_REQUEST_PAYLOAD_BYTES = 128;
/** A parsed address, payment URI or payment request; `amount` in atoms and `payload` are null when none was asked for. */
export interface PaymentRequest {
    address: string;
    amount: bigint | null;
    /** The text the receiver asks to be sent along as the payment's payload, such as an invoice number. */
    payload: string | null;
}
/** Letters, digits, spaces and `. , : ; - _ / # + ( ) ! ? % @ * &`, without outer spaces, up to 128 bytes. */
export declare function isRequestPayload(text: string): boolean;
/**
 * The payment URI of `address` for a QR code: `?amount=` in TRAI when an amount above zero is asked for,
 * `payload=` when a payload is, such as an invoice number the sender's wallet fills in.
 */
export declare function paymentRequest(address: string, network: Network, amount?: bigint, payload?: string): Promise<string>;
/**
 * Reads what a QR code or a pasted text holds: an address, a payment URI, or a payment request with an
 * amount, a payload or both. Anything else, any other parameter or a parameter twice is refused.
 */
export declare function parsePaymentRequest(text: string, network: Network): Promise<PaymentRequest>;
