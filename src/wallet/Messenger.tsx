import { MESSENGER_LIMITS } from "@tenrai/sdk/wallet";
import { type FormEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Ask, Confirm } from "../components/confirm.tsx";
import { AlertIcon, BackIcon, ClockIcon, EmojiIcon, FinalIcon, InfoIcon, LockIcon, PlaneIcon, SentIcon } from "../components/icons.tsx";
import { useToast } from "../components/toast.tsx";
import { problem } from "../problem.ts";
import { ChatInfoDialog, MessageDialog, NewChatDialog } from "./MessengerDialogs.tsx";
import { Room, STATE_TEXT, STATUS_TEXT, UNREADABLE, clock, day } from "./messengerParts.tsx";
import { type MessageStatus, type ShownChat, type ShownMessage, chatTitle, checkText, useMessenger } from "./messengerState.tsx";

const SEARCH_LIMIT = 64;
const EMOJI = [
  "😀", "😂", "😊", "😉", "😍", "😎", "🤔", "😮", "😢", "😡", "🥳", "😅", "🙏", "👍", "👎", "👏",
  "🙌", "👋", "🤝", "💪", "❤️", "🔥", "🎉", "✨", "💯", "✅", "❌", "⚠️", "⏳", "🚀", "💰", "💸",
  "📈", "📉", "🎁", "☕", "🍀", "⭐", "🌙", "👀",
];

function initials(chat: ShownChat): string {
  if (chat.name) {
    return (
      [...chat.name]
        .filter((character) => /\p{L}|\p{N}/u.test(character))
        .slice(0, 2)
        .join("")
        .toUpperCase() || "?"
    );
  }
  return chat.peer.split("1").slice(1).join("1").slice(0, 2).toUpperCase();
}

function when(millis: number | null | undefined): string {
  if (!millis) {
    return "";
  }
  return new Date(millis).toDateString() === new Date().toDateString() ? clock(millis) : new Date(millis).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function preview(chat: ShownChat): string {
  const last = chat.last;
  if (!last) {
    return STATE_TEXT[chat.state];
  }
  if (last.status === "failed") {
    return STATUS_TEXT.failed;
  }
  if (last.kind === "accept" && !last.text) {
    return last.mine ? "You accepted the chat." : `${chatTitle(chat)} accepted the chat.`;
  }
  return last.text === null ? UNREADABLE : last.text || STATE_TEXT[chat.state];
}

function StatusIcon({ status }: { status: MessageStatus }) {
  const label = STATUS_TEXT[status];
  if (status === "failed") {
    return <AlertIcon label={label} />;
  }
  if (status === "finalized") {
    return <FinalIcon label={label} />;
  }
  return status === "queued" || status === "processing" ? <ClockIcon label={label} /> : <SentIcon label={label} />;
}

export function MessengerTab() {
  const messenger = useMessenger();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [info, setInfo] = useState(false);
  const [message, setMessage] = useState<ShownMessage | null>(null);
  const chat = messenger.chats.find((entry) => entry.key === messenger.selected) ?? null;
  const term = search.trim().toLowerCase().slice(0, SEARCH_LIMIT);
  const matches = (entry: ShownChat) => !term || [entry.name ?? "", entry.peer, entry.last?.text ?? ""].some((text) => text.toLowerCase().includes(term));
  const requests = messenger.chats.filter((entry) => entry.state === "request" && matches(entry));
  const others = messenger.chats.filter((entry) => entry.state !== "request" && matches(entry));

  useEffect(() => {
    if (chat && document.visibilityState === "visible") {
      messenger.markRead(chat);
    }
  });

  return (
    <div className="messenger" data-view={chat ? "chat" : "list"}>
      <aside className="messenger__side" aria-label="Chats">
        <div className="messenger__tools">
          <input
            type="search"
            value={search}
            maxLength={SEARCH_LIMIT}
            autoComplete="off"
            placeholder="Search chats"
            aria-label="Search chats"
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="button" className="btn btn--solid" onClick={() => setCreating(true)}>
            New chat
          </button>
        </div>
        {messenger.error && <p className="form-error messenger__error">{messenger.error}</p>}
        {requests.length > 0 && (
          <section>
            <h3 className="messenger__group-title">Requests</h3>
            <ChatList chats={requests} selected={messenger.selected} onSelect={messenger.select} />
          </section>
        )}
        <ChatList chats={others} selected={messenger.selected} onSelect={messenger.select} grow />
        {requests.length + others.length === 0 && (
          <p className="note messenger__empty">
            {!messenger.read ? "Reading the chats…" : messenger.chats.length ? "No chat matches." : "No chats yet. Start one with New chat."}
          </p>
        )}
      </aside>
      <section className="messenger__chat" aria-label="Chat">
        {chat ? (
          <ChatView key={chat.key} chat={chat} onInfo={() => setInfo(true)} onMessage={setMessage} />
        ) : (
          <p className="note messenger__pick">Choose a chat or start a new one.</p>
        )}
      </section>
      {creating && <NewChatDialog onClose={() => setCreating(false)} />}
      {info && chat && <ChatInfoDialog chat={chat} onClose={() => setInfo(false)} />}
      {message && chat && <MessageDialog chat={chat} message={message} onClose={() => setMessage(null)} />}
    </div>
  );
}

function ChatList({ chats, selected, onSelect, grow = false }: { chats: ShownChat[]; selected: string | null; onSelect: (key: string) => void; grow?: boolean }) {
  return (
    <ul className={grow ? "chat-list chat-list--grow" : "chat-list"}>
      {chats.map((chat) => (
        <li key={chat.key}>
          <button type="button" className="chat-item" aria-current={chat.key === selected ? "true" : undefined} onClick={() => onSelect(chat.key)}>
            <span className="avatar">{initials(chat)}</span>
            <span className="chat-item__main">
              <span className="chat-item__name">{chatTitle(chat)}</span>
              <span className="chat-item__last">
                {chat.chatId && <LockIcon label="End-to-end encrypted" />}
                {preview(chat)}
              </span>
            </span>
            <span className="chat-item__side">
              <span className="chat-item__time">{when(chat.last?.time)}</span>
              {chat.unread > 0 && <span className="chat-item__badge">{chat.unread > 99 ? "99+" : chat.unread}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ChatView({ chat, onInfo, onMessage }: { chat: ShownChat; onInfo: () => void; onMessage: (message: ShownMessage) => void }) {
  const messenger = useMessenger();
  const notify = useToast();
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [emoji, setEmoji] = useState(false);
  const [asking, setAsking] = useState<{ title: string; run: () => void } | null>(null);
  const [question, setQuestion] = useState<"block" | "delete" | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const atBottom = useRef(true);
  const title = chatTitle(chat);
  // Without the other side's accept there is no key yet, so nothing more can be written.
  const locked = chat.state === "starting" || chat.state === "waiting";

  useLayoutEffect(() => {
    const node = list.current;
    if (node && atBottom.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [chat.messages.length]);

  useEffect(() => {
    if (!emoji) {
      return;
    }
    const close = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node)) {
        setEmoji(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [emoji]);

  const guarded = (title: string, run: () => void) => {
    setError(undefined);
    try {
      if (messenger.store.ask) {
        setAsking({ title, run });
      } else {
        run();
      }
    } catch (failure) {
      setError(problem(failure));
    }
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    setError(undefined);
    const value = text;
    try {
      checkText(value, MESSENGER_LIMITS.text);
    } catch (failure) {
      setError(problem(failure));
      return;
    }
    guarded("Send message", () => {
      messenger.reply(chat, value);
      setText("");
      setEmoji(false);
    });
  };

  const insert = (value: string) => {
    const node = input.current;
    const start = node?.selectionStart ?? text.length;
    const end = node?.selectionEnd ?? start;
    setText(text.slice(0, start) + value + text.slice(end));
    requestAnimationFrame(() => {
      node?.focus();
      node?.setSelectionRange(start + value.length, start + value.length);
    });
  };

  const block = () => setQuestion("block");

  const remove = () => setQuestion("delete");

  return (
    <div className="messenger__body">
      <header className="messenger__head">
        <button type="button" className="icon-btn messenger__back" aria-label="Back to the chats" onClick={() => messenger.select(null)}>
          <BackIcon />
        </button>
        <button type="button" className="messenger__peer" onClick={onInfo}>
          <span className="avatar">{initials(chat)}</span>
          <span className="messenger__peer-text">
            <span className="messenger__peer-name">{title}</span>
            <span className="messenger__peer-sub" data-secure={Boolean(chat.chatId)}>
              {chat.chatId && <LockIcon />}
              {STATE_TEXT[chat.state]}
            </span>
          </span>
        </button>
        <button type="button" className="icon-btn" aria-label="Chat details" title="Chat details" onClick={onInfo}>
          <InfoIcon />
        </button>
      </header>
      {chat.state === "request" && (
        <div className="messenger__banner" role="status">
          <p>{`${title} wants to chat with you. Answer or accept; from then on every message is end-to-end encrypted.`}</p>
          <div className="actions">
            <button type="button" className="btn btn--solid btn--small" data-action="accept" onClick={() => guarded("Accept the chat", () => messenger.accept(chat))}>
              Accept
            </button>
            <button type="button" className="btn btn--ghost btn--small" data-action="block" onClick={block}>
              Block
            </button>
            <button type="button" className="btn btn--ghost btn--small" data-action="delete_chat" onClick={remove}>
              Delete chat
            </button>
          </div>
        </div>
      )}
      {chat.state === "waiting" && (
        <div className="messenger__banner" role="status">
          <p>{`Waiting for ${title} to accept. You can write as soon as they do; from then on every message is end-to-end encrypted.`}</p>
        </div>
      )}
      {chat.state === "starting" && (
        <div className="messenger__banner" role="status">
          <p>The chat request goes out as soon as coins are free.</p>
        </div>
      )}
      <ol
        className="messages"
        ref={list}
        aria-live="polite"
        onScroll={(event) => {
          const node = event.currentTarget;
          atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
        }}
      >
        <li className="messages__secure" data-secure={Boolean(chat.chatId)}>
          <LockIcon />
          <span>
            {chat.chatId
              ? `Messages in this chat are end-to-end encrypted. Only you and ${title} can read them.`
              : "Not encrypted yet. Everyone can read the first message; encryption starts with the answer."}
          </span>
        </li>
        <Messages chat={chat} onMessage={onMessage} />
      </ol>
      <form className="composer" data-locked={locked} noValidate onSubmit={submit}>
        <div className="composer__emoji-box" ref={picker}>
          <button
            type="button"
            className="icon-btn composer__emoji"
            aria-label="Emoji"
            title="Emoji"
            aria-expanded={emoji}
            disabled={locked}
            onClick={() => setEmoji((open) => !open)}
          >
            <EmojiIcon />
          </button>
          {emoji && (
            <div
              className="emoji-panel"
              role="group"
              aria-label="Emoji"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setEmoji(false);
                }
              }}
            >
              {EMOJI.map((value) => (
                <button key={value} type="button" className="emoji-panel__pick" onClick={() => insert(value)}>
                  {value}
                </button>
              ))}
            </div>
          )}
        </div>
        <textarea
          ref={input}
          rows={Math.min(6, Math.max(1, text.split("\n").length))}
          maxLength={2048}
          value={text}
          disabled={locked}
          placeholder={chat.state === "request" ? "Answer to accept" : "Message"}
          aria-label="Message"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit" className="btn btn--solid composer__send" aria-label="Send" title="Send" disabled={locked}>
          <PlaneIcon />
        </button>
        <Room text={text} limit={MESSENGER_LIMITS.text} />
        {error && <p className="form-error composer__error">{error}</p>}
        <p className="composer__wait" role="status">
          <ClockIcon />
          <span>{locked ? `You can write once ${title} accepts the chat.` : ""}</span>
        </p>
      </form>
      {asking && (
        <Confirm
          title={asking.title}
          facts={[
            ["To", title],
            ["Moves", "one atom and the network fee"],
          ]}
          action="Send"
          password
          onConfirm={async () => asking.run()}
          onClose={() => setAsking(null)}
        />
      )}
      {question === "block" && (
        <Ask
          title="Block"
          text={`Block ${title}? Their messages stay hidden on this device. They can still send them, each for a fee.`}
          action="Block"
          onConfirm={() => {
            messenger.block(chat.peer);
            notify(`${title} is blocked.`);
          }}
          onClose={() => setQuestion(null)}
        />
      )}
      {question === "delete" && (
        <Ask
          title="Delete chat"
          text="Delete this chat on this device? Its messages stay on chain, and a new message brings the chat back."
          action="Delete chat"
          onConfirm={() => {
            messenger.deleteChat(chat);
            notify("Chat deleted on this device.");
          }}
          onClose={() => setQuestion(null)}
        />
      )}
    </div>
  );
}

function Messages({ chat, onMessage }: { chat: ShownChat; onMessage: (message: ShownMessage) => void }) {
  const rows: ReactNode[] = [];
  let shownDay = "";
  let sealed = false;
  for (const message of chat.messages) {
    const label = message.time ? day(message.time) : "";
    if (label && label !== shownDay) {
      shownDay = label;
      rows.push(
        <li key={`day:${label}`} className="messages__day">
          {label}
        </li>,
      );
    }
    // Where the chat leaves its public first message behind.
    if (message.encrypted && !sealed && chat.chatId) {
      sealed = true;
      rows.push(
        <li key="sealed" className="messages__divider">
          <LockIcon />
          <span>End-to-end encrypted from here on</span>
        </li>,
      );
    }
    rows.push(<Bubble key={message.key} chat={chat} message={message} onOpen={onMessage} />);
  }
  return <>{rows}</>;
}

function Bubble({ chat, message, onOpen }: { chat: ShownChat; message: ShownMessage; onOpen: (message: ShownMessage) => void }) {
  if (message.kind !== "message" && message.text === "") {
    const name = chatTitle(chat);
    const note =
      message.kind === "request"
        ? message.mine
          ? "You started the chat."
          : `${name} started the chat.`
        : message.mine
          ? "You accepted the chat."
          : `${name} accepted the chat.`;
    return <li className="messages__note">{note}</li>;
  }
  return (
    <li className={message.mine ? "bubble bubble--mine" : "bubble"}>
      <button type="button" className="bubble__body" onClick={() => onOpen(message)}>
        {message.text === null ? <span className="bubble__unreadable">{UNREADABLE}</span> : <span className="bubble__text">{message.text}</span>}
        <span className="bubble__meta">
          {!message.encrypted && <span className="bubble__public">Visible to everyone</span>}
          {message.time !== null && <span>{clock(message.time)}</span>}
          {message.mine && <StatusIcon status={message.status} />}
        </span>
      </button>
      {message.status === "failed" && <p className="bubble__error">{`${STATUS_TEXT.failed}: ${message.error ?? ""}`}</p>}
    </li>
  );
}
