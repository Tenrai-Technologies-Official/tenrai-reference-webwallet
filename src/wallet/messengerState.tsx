import { isFinal, type TransactionLifecycle } from "@tenrai/sdk";
import { type Chat, type ChatMessage, MESSENGER_LIMITS, type PreparedTransfer, TenraiWalletError, isChatText } from "@tenrai/sdk/wallet";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../components/toast.tsx";
import { shortAddress } from "../format.ts";
import { problem } from "../problem.ts";
import { readyToSend } from "../sync.ts";
import { tenrai } from "../tenrai.ts";
import { MAX_KEPT_FRAMES } from "./history.ts";
import type { MessengerStore } from "./messengerStore.ts";
import { useSession } from "./session.tsx";

const FIRST_READ = 1_000;
const LATER_READ = 100;
const RETRY_MILLIS = 5_000;
const MAX_QUEUED = 50;
const encoder = new TextEncoder();

export type MessageStatus = TransactionLifecycle | "queued" | "failed";

export interface ShownMessage {
  key: string;
  transactionId: string | null;
  local: string | null;
  kind: ChatMessage["kind"];
  mine: boolean;
  text: string | null;
  encrypted: boolean;
  time: number | null;
  status: MessageStatus;
  error: string | null;
}

export interface ShownChat {
  key: string;
  request: string | null;
  peer: string;
  own: string | null;
  peerId: string | null;
  chatId: string | null;
  name: string | null;
  state: Chat["state"] | "starting";
  messages: ShownMessage[];
  unread: number;
  last: ShownMessage | null;
}

interface Outgoing {
  id: string;
  kind: ChatMessage["kind"];
  to: string | null;
  request: string | null;
  text: string;
  created: number;
  transactionId: string | null;
  failed: string | null;
}

interface Messenger {
  active: boolean;
  id: string;
  store: MessengerStore;
  chats: ShownChat[];
  read: boolean;
  error?: string;
  unread: number;
  selected: string | null;
  select: (key: string | null) => void;
  openChat: (transactionId: string) => void;
  start: (to: string, note: string) => void;
  reply: (chat: ShownChat, text: string) => void;
  accept: (chat: ShownChat) => void;
  retry: (local: string) => void;
  forget: (message: ShownMessage) => void;
  block: (address: string) => void;
  unblock: (address: string) => void;
  deleteChat: (chat: ShownChat) => void;
  markRead: (chat: ShownChat) => void;
  rename: (address: string, name: string) => void;
  setEnabled: (enabled: boolean) => void;
  setAsk: (ask: boolean) => void;
}

const MessengerContext = createContext<Messenger | null>(null);

export function useMessenger(): Messenger {
  const messenger = useContext(MessengerContext);
  if (!messenger) {
    throw new Error("useMessenger needs an open wallet");
  }
  return messenger;
}

export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

export function room(text: string, limit: number): { over: boolean; count: number; wide: boolean } {
  const used = byteLength(text);
  const wide = [...text].some((character) => byteLength(character) > 1);
  return used <= limit ? { over: false, count: limit - used, wide } : { over: true, count: used - limit, wide };
}

export function chatTitle(chat: { name: string | null; peer: string }): string {
  return chat.name ?? shortAddress(chat.peer);
}

export function checkText(text: string, limit: number, empty = false): string {
  if (!empty && !text.trim()) {
    throw new Error("Write a message first.");
  }
  if (!isChatText(text)) {
    throw new Error("The text holds characters the wallet cannot show safely, such as hidden or direction characters.");
  }
  if (byteLength(text) > limit) {
    throw new Error(`The text is longer than ${limit} bytes.`);
  }
  return text;
}

function localId(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function lastTime(chat: ShownChat): number {
  return chat.last?.time ?? chat.messages[0]?.time ?? 0;
}

function queuedMessage(item: Outgoing, status: MessageStatus): ShownMessage {
  return {
    key: item.transactionId ?? `local:${item.id}`,
    transactionId: item.transactionId,
    local: item.id,
    kind: item.kind,
    mine: true,
    text: item.text,
    encrypted: item.kind !== "request",
    time: item.created,
    status: item.failed ? "failed" : status,
    error: item.failed,
  };
}

// A long reply waits for the accept frame to be sent.
function ready(item: Outgoing, chats: Chat[], outbox: Outgoing[]): boolean {
  if (item.kind === "request") {
    return true;
  }
  const chat = chats.find((entry) => entry.request === item.request);
  if (!chat || item.kind === "accept") {
    return Boolean(chat);
  }
  const accepts = outbox.filter((entry) => entry.kind === "accept" && entry.request === item.request);
  return !accepts.some((entry) => !entry.transactionId) && (Boolean(chat.chatId) || accepts.length > 0);
}

export function MessengerProvider({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  const { wallet, history, data, sent, track, salvage, incomingPayloads } = useSession();
  const notify = useToast();
  const store = history.messenger;
  // Rebuild sessions when incoming payloads change to drop old frames from memory.
  const messenger = useMemo(() => {
    const created = wallet.messenger(tenrai);
    created.importFrames(history.frames);
    return created;
  }, [wallet, history, incomingPayloads]);
  const id = useMemo(() => messenger.id(), [messenger]);
  const [version, setVersion] = useState(0);
  const changed = useCallback(() => setVersion((value) => value + 1), []);
  const [chats, setChats] = useState<Chat[]>();
  const [error, setError] = useState<string>();
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [selected, select] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const active = store.enabled && incomingPayloads;

  const queue = useRef<Outgoing[]>([]);
  const latestChats = useRef<Chat[]>([]);
  const latestData = useRef(data);
  latestData.current = data;
  const latestSent = useRef(sent);
  latestSent.current = sent;
  const writeQueue = useCallback((next: Outgoing[]) => {
    queue.current = next;
    setOutbox(next);
  }, []);
  const updateItem = useCallback(
    (itemId: string, change: Partial<Outgoing>) => writeQueue(queue.current.map((item) => (item.id === itemId ? { ...item, ...change } : item))),
    [writeQueue],
  );

  const reader = useRef({ running: false, again: false, first: true, alive: true });
  useEffect(() => {
    const state = reader.current;
    state.alive = true;
    return () => {
      state.alive = false;
    };
  }, []);
  useEffect(() => {
    reader.current.first = true;
  }, [messenger]);
  const readChats = useCallback(async () => {
    const state = reader.current;
    if (state.running) {
      state.again = true;
      return;
    }
    state.running = true;
    try {
      do {
        state.again = false;
        const listed = new Set(latestData.current?.activity.map((entry) => entry.transactionId) ?? []);
        const list = await messenger.chats({ limit: state.first ? Math.min(history.keep, FIRST_READ) : LATER_READ });
        state.first = false;
        if (!state.alive) {
          return;
        }
        history.setFrames(messenger.exportFrames(MAX_KEPT_FRAMES));
        latestChats.current = list;
        setChats(list);
        setError(undefined);
        const onChain = new Set(list.flatMap((chat) => [chat.request, ...chat.messages.map((message) => message.transactionId)]));
        // Drop frames that failed validation.
        writeQueue(queue.current.filter((item) => !item.transactionId || !(onChain.has(item.transactionId) || listed.has(item.transactionId))));
      } while (state.again && state.alive);
    } catch (failure) {
      if (state.alive) {
        // Retry only unread transactions.
        setError(problem(failure));
        window.setTimeout(() => setAttempt((count) => count + 1), RETRY_MILLIS);
      }
    } finally {
      state.running = false;
    }
  }, [messenger, history, writeQueue]);

  const loadedAt = data?.loadedAt;
  useEffect(() => {
    if (active && loadedAt !== undefined) {
      void readChats();
    }
  }, [active, loadedAt, attempt, readChats]);

  const pumping = useRef(false);
  const retryTimer = useRef(0);
  const pump = useCallback(async () => {
    if (pumping.current || !active) {
      return;
    }
    pumping.current = true;
    clearTimeout(retryTimer.current);
    const atoms = (transfer: PreparedTransfer) => -(transfer.amount + transfer.fee);
    try {
      for (;;) {
        const list = latestChats.current;
        const item = queue.current.find((entry) => !entry.transactionId && !entry.failed && ready(entry, list, queue.current));
        if (!item) {
          return;
        }
        const chat = list.find((entry) => entry.request === item.request);
        // Send a message if another device already accepted the chat.
        if (item.kind === "accept" && chat?.chatId) {
          if (!item.text) {
            writeQueue(queue.current.filter((entry) => entry.id !== item.id));
            continue;
          }
          item.kind = "message";
        }
        try {
          await readyToSend(notify);
          const transfer =
            item.kind === "request"
              ? await messenger.start(item.to as string, item.text)
              : item.kind === "accept"
                ? await messenger.accept(chat as Chat, item.text)
                : await messenger.send(chat as Chat, item.text);
          track("Messenger", [transfer], atoms);
          updateItem(item.id, { kind: item.kind, transactionId: transfer.transactionId });
          if (item.kind === "request") {
            select((current) => (current === `local:${item.id}` ? transfer.transactionId : current));
          }
        } catch (failure) {
          if (salvage("Messenger", failure, atoms)) {
            const lost = (failure as TenraiWalletError).details["transfer"] as PreparedTransfer;
            updateItem(item.id, { kind: item.kind, transactionId: lost.transactionId });
            continue;
          }
          // Wait for finality to release the reserved inputs.
          const busy = latestSent.current.some((entry) => !entry.status || !isFinal(entry.status));
          if (failure instanceof TenraiWalletError && failure.code === "insufficient" && busy) {
            retryTimer.current = window.setTimeout(() => void pump(), RETRY_MILLIS);
            return;
          }
          updateItem(item.id, { failed: problem(failure) });
        }
      }
    } finally {
      pumping.current = false;
    }
  }, [active, messenger, notify, track, salvage, updateItem, writeQueue]);

  useEffect(() => {
    void pump();
  }, [pump, chats, outbox]);
  useEffect(() => () => clearTimeout(retryTimer.current), []);

  const enqueue = useCallback(
    (items: Omit<Outgoing, "id" | "created" | "transactionId" | "failed">[]) => {
      if (queue.current.filter((item) => !item.transactionId).length + items.length > MAX_QUEUED) {
        throw new Error("Too many messages wait to be sent; wait until some went out.");
      }
      const created = Date.now();
      const fresh = items.map((item) => ({ ...item, id: localId(), created, transactionId: null, failed: null }));
      writeQueue([...queue.current, ...fresh]);
      return fresh;
    },
    [writeQueue],
  );

  const statuses = useMemo(() => new Map(sent.map((entry) => [entry.transactionId, entry])), [sent]);
  const shown = useMemo(() => {
    if (!active || !chats) {
      return [];
    }
    const status = (item: Outgoing): MessageStatus => {
      if (!item.transactionId) {
        return "queued";
      }
      const entry = statuses.get(item.transactionId);
      return entry?.unknown ? "failed" : (entry?.status?.lifecycle ?? "processing");
    };
    const list: ShownChat[] = [];
    for (const chat of chats) {
      if (store.blocked.includes(chat.peer)) {
        continue;
      }
      const skip = store.deleted.get(chat.request) ?? 0;
      const messages: ShownMessage[] = chat.messages
        .slice(skip)
        .filter((message) => !store.hidden.has(message.transactionId))
        .map((message) => ({ ...message, key: message.transactionId, local: null, status: "finalized", error: null }));
      const queued = outbox.filter((item) => item.request === chat.request).map((item) => queuedMessage(item, status(item)));
      if (skip > 0 && messages.length + queued.length === 0) {
        continue;
      }
      const read = store.read.get(chat.request) ?? 0;
      const unread = chat.messages
        .slice(read)
        .filter((message) => !message.mine && !store.hidden.has(message.transactionId) && (message.time ?? Date.now()) >= store.since).length;
      const all = [...messages, ...queued];
      list.push({
        key: chat.request,
        request: chat.request,
        peer: chat.peer,
        own: chat.own,
        peerId: chat.peerId,
        chatId: chat.chatId,
        name: store.names.get(chat.peer) ?? null,
        state: chat.state,
        messages: all,
        unread,
        last: all.at(-1) ?? null,
      });
    }
    const listed = new Set(list.map((chat) => chat.key));
    for (const item of outbox) {
      const key = item.transactionId ?? `local:${item.id}`;
      if (item.kind !== "request" || listed.has(key) || store.blocked.includes(item.to as string)) {
        continue;
      }
      const message = queuedMessage(item, status(item));
      list.push({
        key,
        request: item.transactionId,
        peer: item.to as string,
        own: null,
        peerId: null,
        chatId: null,
        name: store.names.get(item.to as string) ?? null,
        state: item.transactionId ? "waiting" : "starting",
        messages: [message],
        unread: 0,
        last: message,
      });
    }
    return list.sort((a, b) => lastTime(b) - lastTime(a));
  }, [active, chats, outbox, statuses, store, version]);

  useEffect(() => {
    if (!active) {
      select(null);
    }
  }, [active]);

  const value: Messenger = {
    active,
    id,
    store,
    chats: shown,
    read: chats !== undefined,
    error,
    unread: shown.reduce((total, chat) => total + chat.unread, 0),
    selected,
    select,
    openChat: (transactionId) => {
      const chat = shown.find((entry) => entry.request === transactionId || entry.messages.some((message) => message.transactionId === transactionId));
      if (chat) {
        select(chat.key);
        onOpen();
      }
    },
    start: (to, note) => {
      if (wallet.owns(to)) {
        throw new Error("That is one of your own addresses.");
      }
      if (store.blocked.includes(to)) {
        throw new Error("You blocked this address; unblock it under Settings, Messenger first.");
      }
      const [item] = enqueue([{ kind: "request", to, request: null, text: checkText(note, MESSENGER_LIMITS.note, true) }]);
      select(`local:${item?.id}`);
    },
    reply: (chat, text) => {
      checkText(text, MESSENGER_LIMITS.text);
      if (!chat.request) {
        throw new Error("This chat has not started yet.");
      }
      const request = chat.request;
      if (chat.state === "waiting" || chat.state === "starting") {
        throw new Error(`You can write once ${chatTitle(chat)} accepts the chat.`);
      }
      if (chat.state === "request") {
        enqueue(
          byteLength(text) <= MESSENGER_LIMITS.accept
            ? [{ kind: "accept", to: null, request, text }]
            : [
                { kind: "accept", to: null, request, text: "" },
                { kind: "message", to: null, request, text },
              ],
        );
        return;
      }
      enqueue([{ kind: "message", to: null, request, text }]);
    },
    accept: (chat) => {
      if (chat.state === "request" && chat.request) {
        enqueue([{ kind: "accept", to: null, request: chat.request, text: "" }]);
      }
    },
    retry: (local) => updateItem(local, { failed: null }),
    forget: (message) => {
      if (message.local && !message.transactionId) {
        writeQueue(queue.current.filter((item) => item.id !== message.local));
      } else if (message.transactionId) {
        store.hide(message.transactionId);
        changed();
      }
    },
    block: (address) => {
      store.block(address);
      writeQueue(queue.current.filter((item) => item.transactionId || item.to !== address));
      select(null);
      changed();
    },
    unblock: (address) => {
      store.unblock(address);
      changed();
    },
    deleteChat: (chat) => {
      const raw = chats?.find((entry) => entry.request === chat.request);
      if (raw) {
        store.deleteChat(raw.request, raw.messages.length);
      }
      writeQueue(queue.current.filter((item) => item.transactionId || (item.request !== chat.request && `local:${item.id}` !== chat.key)));
      select(null);
      changed();
    },
    markRead: (chat) => {
      const raw = chats?.find((entry) => entry.request === chat.request);
      if (raw && store.markRead(raw.request, raw.messages.length)) {
        changed();
      }
    },
    rename: (address, name) => {
      store.setName(address, name);
      changed();
    },
    setEnabled: (enabled) => {
      store.setEnabled(enabled);
      changed();
    },
    setAsk: (ask) => {
      store.setAsk(ask);
      changed();
    },
  };

  return <MessengerContext value={value}>{children}</MessengerContext>;
}
