import { count } from "../format.ts";
import { type MessageStatus, type ShownChat, room } from "./messengerState.tsx";

export const STATE_TEXT: Record<ShownChat["state"], string> = {
  open: "End-to-end encrypted",
  waiting: "Waiting for them to accept",
  request: "Wants to chat with you",
  starting: "Starting the chat",
};

export const STATUS_TEXT: Record<MessageStatus, string> = {
  queued: "Waiting to be sent",
  failed: "Not sent",
  processing: "In mempool",
  receiving: "Mined",
  registered: "Registered",
  finalized: "Finalized",
};

export const UNREADABLE = "This message holds characters the wallet does not show.";

export function day(millis: number): string {
  return new Date(millis).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export function clock(millis: number): string {
  return new Date(millis).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** A chat text's room: what fits after the frame's key, ids and encryption. */
export function Room({ text, limit }: { text: string; limit: number }) {
  const left = room(text, limit);
  return (
    <p className="note composer__count" data-over={left.over}>
      {left.over ? `Characters over the limit: ${count(left.count)}` : `Characters left: ${count(left.count)}`}
      {left.wide && " · Emoji and some letters, such as accented ones, count several times."}
    </p>
  );
}
