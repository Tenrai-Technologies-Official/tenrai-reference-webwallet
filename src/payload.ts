import { isSafeText } from "@tenrai/sdk/wallet";
import { hexOf } from "./bytes.ts";
import { count } from "./format.ts";

export type PayloadFormat = "text" | "hex";

/** The payload limit until the node's manifest says otherwise. */
export const DEFAULT_PAYLOAD_LIMIT = 1_024;

export interface PayloadInput {
  /** What goes to the SDK: text as UTF-8, or the bytes of the hex. */
  payload?: string | Uint8Array;
  /** The same as hex, for the activity. */
  hex: string;
  size: number;
  problem?: string;
}

/** Checks the payload field as typed, by the rules applied when signing. */
export function payloadInput(format: PayloadFormat, value: string, limit: number): PayloadInput {
  if (value === "") {
    return { hex: "", size: 0 };
  }
  let data: Uint8Array;
  if (format === "hex") {
    const clean = value.trim();
    if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
      return { hex: "", size: 0, problem: "Hex takes pairs of the digits 0-9 and a-f." };
    }
    data = Uint8Array.from(clean.match(/../g) ?? [], (pair) => parseInt(pair, 16));
  } else {
    if (!isSafeText(value)) {
      return { hex: "", size: 0, problem: "The text holds control or invisible characters; send such data as hex." };
    }
    data = new TextEncoder().encode(value);
  }
  if (data.length > limit) {
    return { hex: "", size: data.length, problem: `${count(data.length)} bytes; the network takes at most ${count(limit)}.` };
  }
  return { payload: format === "text" ? value : data, hex: hexOf(data), size: data.length };
}

export interface RecipientPayloadsInput {
  /** How many recipients have their own payload. */
  count: number;
  /** All of them in the recipient layout, marker and headers included. */
  size: number;
  problem?: string;
}

/** Checks per-recipient payload texts in recipient order. */
export function recipientPayloadsInput(texts: string[], limit: number): RecipientPayloadsInput {
  let given = 0;
  let size = 5;
  for (const [index, text] of texts.entries()) {
    if (!text) {
      continue;
    }
    if (!isSafeText(text)) {
      return { count: given, size, problem: `The payload of recipient ${index + 1} holds control or invisible characters.` };
    }
    given += 1;
    size += 3 + new TextEncoder().encode(text).length;
  }
  if (given === 0) {
    return { count: 0, size: 0 };
  }
  if (size > limit) {
    return { count: given, size, problem: `${count(size)} bytes with their headers; the network takes at most ${count(limit)}.` };
  }
  return { count: given, size };
}
