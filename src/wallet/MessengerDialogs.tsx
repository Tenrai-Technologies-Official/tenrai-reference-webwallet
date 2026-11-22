import { MESSENGER_LIMITS, parsePaymentRequest } from "@tenrai/sdk/wallet";
import { type FormEvent, type ReactNode, useState } from "react";
import { Ask, Confirm } from "../components/confirm.tsx";
import { Dialog } from "../components/dialog.tsx";
import { Facts } from "../components/facts.tsx";
import { AddressCheck, Field, useAddressCheck } from "../components/fields.tsx";
import { ScanIcon } from "../components/icons.tsx";
import { ScanDialog } from "../components/scanner.tsx";
import { useToast } from "../components/toast.tsx";
import { CopyButton, CopyIconButton, TxId } from "../components/values.tsx";
import { wordsOf } from "../components/words.tsx";
import { addressUrl } from "../explorer.ts";
import { problem } from "../problem.ts";
import { MAX_NAME_CHARS } from "./messengerStore.ts";
import { Room, STATUS_TEXT, UNREADABLE, clock, day } from "./messengerParts.tsx";
import { type ShownChat, type ShownMessage, chatTitle, checkText, useMessenger } from "./messengerState.tsx";
import { useSession } from "./session.tsx";

export function NewChatDialog({ onClose }: { onClose: () => void }) {
  const { network } = useSession();
  const messenger = useMessenger();
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const [asking, setAsking] = useState(false);
  const check = useAddressCheck(to, network);

  const start = () => {
    messenger.start(to.trim(), note);
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      if (check !== "valid") {
        throw new Error(`Enter a ${network} address.`);
      }
      checkText(note, MESSENGER_LIMITS.note, true);
      if (messenger.store.ask) {
        setAsking(true);
      } else {
        start();
      }
    } catch (failure) {
      setError(problem(failure));
    }
  };

  return (
    <Dialog title="New chat" onClose={onClose}>
      <form className="stack-form" noValidate onSubmit={submit}>
        <Field label="Address" hint={<AddressCheck state={check} network={network} />}>
          <span className="with-button">
            <input value={to} autoComplete="off" spellCheck={false} maxLength={256} autoFocus onChange={(event) => setTo(event.target.value)} />
            <button type="button" className="icon-btn icon-btn--field" aria-label="Scan a QR code" title="Scan a QR code" onClick={() => setScanning(true)}>
              <ScanIcon />
            </button>
          </span>
        </Field>
        <Field label="First message, optional">
          <textarea className="composer-note" rows={3} maxLength={1024} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <Room text={note} limit={MESSENGER_LIMITS.note} />
        <p className="note">
          Everyone can read the first message. Once the other side accepts, every message is end-to-end encrypted. Each message sends one atom and pays
          a small network fee.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions actions--end">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--solid">
            Start chat
          </button>
        </div>
      </form>
      {scanning && (
        <ScanDialog
          onText={async (text) => {
            try {
              setTo((await parsePaymentRequest(text, network)).address);
              setScanning(false);
              return true;
            } catch {
              return false;
            }
          }}
          onClose={() => setScanning(false)}
        />
      )}
      {asking && (
        <Confirm
          title="Start chat"
          facts={[
            ["To", to.trim()],
            ["Moves", "one atom and the network fee"],
          ]}
          action="Send"
          password
          onConfirm={async () => start()}
          onClose={() => setAsking(false)}
        />
      )}
    </Dialog>
  );
}

export function ChatInfoDialog({ chat, onClose }: { chat: ShownChat; onClose: () => void }) {
  const messenger = useMessenger();
  const notify = useToast();
  const [name, setName] = useState(chat.name ?? "");
  const [error, setError] = useState<string>();
  const [question, setQuestion] = useState<"block" | "delete" | null>(null);
  const blocked = messenger.store.blocked.includes(chat.peer);
  const title = chatTitle(chat);

  const rename = (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      messenger.rename(chat.peer, name);
      onClose();
    } catch (failure) {
      setError(problem(failure));
    }
  };

  const toggleBlock = () => {
    if (blocked) {
      messenger.unblock(chat.peer);
      notify(`${title} is no longer blocked.`);
      onClose();
      return;
    }
    setQuestion("block");
  };

  const remove = () => setQuestion("delete");

  return (
    <Dialog title={title} onClose={onClose}>
      <Facts
        rows={[
          [
            "Address",
            <span className="address-line">
              <span className="mono address-box">{chat.peer}</span>
              <CopyIconButton text={chat.peer} label="Copy address" />
            </span>,
          ],
          ["Verification words", wordsOf(chat.peer) ?? "-"],
          ...(chat.peerId ? [["Their Messenger ID", <span className="mono">{chat.peerId}</span>] as [string, ReactNode]] : []),
          ["Encryption", chat.chatId ? "End-to-end encrypted" : "Not yet, the chat waits to be accepted"],
          ...(chat.chatId ? [["Chat fingerprint", <span className="mono">{chat.chatId.match(/.{4}/g)?.join(" ").toUpperCase()}</span>] as [string, ReactNode]] : []),
        ]}
      />
      <form className="inline-form" noValidate onSubmit={rename}>
        <Field label="Name on this device">
          <input value={name} maxLength={MAX_NAME_CHARS} autoComplete="off" onChange={(event) => setName(event.target.value)} />
        </Field>
        <button type="submit" className="btn btn--ghost">
          Save
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
      <div className="actions messenger__danger">
        <a className="btn btn--ghost" href={addressUrl(chat.peer)} target="_blank" rel="noopener noreferrer">
          Open in the explorer
        </a>
        <button type="button" className="btn btn--ghost" onClick={toggleBlock}>
          {blocked ? "Unblock" : "Block"}
        </button>
        {chat.request && (
          <button type="button" className="btn btn--danger" onClick={remove}>
            Delete chat
          </button>
        )}
      </div>
      {question === "block" && (
        <Ask
          title="Block"
          text={`Block ${title}? Their messages stay hidden on this device. They can still send them, each for a fee.`}
          action="Block"
          onConfirm={() => {
            onClose();
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
            onClose();
            messenger.deleteChat(chat);
            notify("Chat deleted on this device.");
          }}
          onClose={() => setQuestion(null)}
        />
      )}
    </Dialog>
  );
}

export function MessageDialog({ chat, message, onClose }: { chat: ShownChat; message: ShownMessage; onClose: () => void }) {
  const messenger = useMessenger();
  const shown = chat.messages.find((entry) => entry.key === message.key || (entry.local !== null && entry.local === message.local)) ?? message;
  const state = shown.status === "failed" ? `${STATUS_TEXT.failed}: ${shown.error ?? ""}` : STATUS_TEXT[shown.status];
  return (
    <Dialog title="Message" onClose={onClose}>
      <p className="message-text">{shown.text ?? UNREADABLE}</p>
      <Facts
        rows={[
          ...(shown.time ? [["Time", `${day(shown.time)} ${clock(shown.time)}`] as [string, string]] : []),
          ["State", state],
          ["Encryption", shown.encrypted ? "End-to-end encrypted" : "Visible to everyone"],
          ...(shown.transactionId ? [["Transaction", <TxId id={shown.transactionId} />] as [string, ReactNode]] : []),
        ]}
      />
      <div className="actions actions--end">
        {shown.text && <CopyButton text={shown.text} label="Copy text" />}
        {shown.status === "failed" && shown.local && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              messenger.retry(shown.local as string);
              onClose();
            }}
          >
            Send again
          </button>
        )}
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => {
            messenger.forget(shown);
            onClose();
          }}
        >
          Delete for me
        </button>
      </div>
    </Dialog>
  );
}
