import { CopyButton } from "../components/values.tsx";
import { shortAddress } from "../format.ts";
import { useMessenger } from "./messengerState.tsx";
import { useSession } from "./session.tsx";

export function MessengerSettings() {
  const { incomingPayloads } = useSession();
  const messenger = useMessenger();
  const store = messenger.store;
  return (
    <>
      <article className="card">
        <h3 className="card__title">Messenger</h3>
        <label className="check">
          <input type="checkbox" checked={store.enabled && incomingPayloads} disabled={!incomingPayloads} onChange={(event) => messenger.setEnabled(event.target.checked)} />
          <span>Show the messenger</span>
        </label>
        {!incomingPayloads && <p className="note">Off while payloads of incoming payments are not shown, under This device.</p>}
        <label className="check">
          <input type="checkbox" checked={store.ask} onChange={(event) => messenger.setAsk(event.target.checked)} />
          <span>Ask for the password before each message</span>
        </label>
        <p className="note">Each message moves one atom and a small fee, so by default it goes out without the password.</p>
      </article>
      <article className="card">
        <h3 className="card__title">Your Messenger ID</h3>
        <p className="mono messenger-id">{messenger.id}</p>
        <p className="note">
          Comes from the recovery phrase by a one-way derivation and is the same on every device with this wallet. It tells nothing about the phrase, but
          whoever has the phrase can read every chat.
        </p>
        <div className="actions">
          <CopyButton text={messenger.id} label="Copy ID" />
        </div>
      </article>
      <article className="card">
        <h3 className="card__title">Blocked addresses</h3>
        {store.blocked.length === 0 ? (
          <p className="note">No blocked addresses.</p>
        ) : (
          <ul className="blocked-list">
            {store.blocked.map((address) => (
              <li key={address} className="blocked-row">
                <span className="mono" title={address}>
                  {store.names.get(address) ?? shortAddress(address)}
                </span>
                <button type="button" className="btn btn--ghost btn--small" onClick={() => messenger.unblock(address)}>
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>
    </>
  );
}
