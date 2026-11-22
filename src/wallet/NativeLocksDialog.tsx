import { formatTrai, parseTrai, type UtxoRecord } from "@tenrai/sdk";
import { NativeLockSession, type NativeLockDescriptor, type NativeLockSpendReview, type PreparedTransfer } from "@tenrai/sdk/wallet";
import { useEffect, useRef, useState } from "react";
import { SecretForm } from "../components/confirm.tsx";
import { Dialog } from "../components/dialog.tsx";
import { Facts } from "../components/facts.tsx";
import { problem } from "../problem.ts";
import { tenrai } from "../tenrai.ts";
import { checkPassword } from "../vault.ts";
import { useSession } from "./session.tsx";
import { decodeNativeLockBackup, encodeNativeLockBackup } from "./native-lock-backups.ts";

function NativeLockNotice({ type }: { type: NativeLockDescriptor["type"] }) {
  if (type === "hashlock") return <p role="note">A hashlock has no expiry or refund path. Losing the secret preimage leaves the coins unspendable. Choose an HTLC for a swap with a refund path.</p>;
  if (type === "htlc") return <p role="note">An HTLC is the swap option with a refund path and an exactly 32-byte claim preimage. At or after the refund height, the refund owner must sign and submit a refund transaction. Coins do not move automatically, and a closed browser cannot monitor or submit a refund.</p>;
  return null;
}

/** Descriptors are public recovery data. Preimages stay in this mounted dialog until submitted. */
export function NativeLocksDialog({ onClose }: { onClose: () => void }) {
  const { wallet, network, receiveIndex, asks, track, salvage, refresh } = useSession();
  const storageKey = `tenrai-native-locks-v1:${network}:${wallet.fingerprint}`;
  const [session, setSession] = useState<NativeLockSession>();
  const [locks, setLocks] = useState<NativeLockDescriptor[]>([]);
  const [selected, setSelected] = useState<string>();
  const [kind, setKind] = useState<"timelock" | "hashlock" | "htlc">("timelock");
  const [owner, setOwner] = useState(wallet.address(receiveIndex));
  const [refund, setRefund] = useState(wallet.address(receiveIndex));
  const [height, setHeight] = useState("");
  const [hash, setHash] = useState("");
  const [secret, setSecret] = useState("");
  const [imported, setImported] = useState("");
  const [coins, setCoins] = useState<readonly UtxoRecord[]>([]);
  const [chosen, setChosen] = useState("");
  const [branch, setBranch] = useState<"claim" | "refund">("claim");
  const [preimage, setPreimage] = useState("");
  const [destination, setDestination] = useState(wallet.address(receiveIndex));
  const [keyIndex, setKeyIndex] = useState(String(receiveIndex));
  const [keyBranch, setKeyBranch] = useState<"receive" | "change">("receive");
  const [amount, setAmount] = useState("");
  const [password, setPassword] = useState("");
  const [funding, setFunding] = useState<PreparedTransfer>();
  const [fundingAttempted, setFundingAttempted] = useState(false);
  const [review, setReview] = useState<NativeLockSpendReview>();
  const [signed, setSigned] = useState<PreparedTransfer>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const lock = locks.find((entry) => entry.descriptor_hex === selected);

  useEffect(() => {
    let active = true;
    void tenrai.transactions.manifest().then(NativeLockSession.fromManifest).then((next) => {
      if (!active) return;
      const text = localStorage.getItem(storageKey);
      let restored: NativeLockDescriptor[] = [];
      if (text !== null) {
        if (text.length > 64 * 1024) throw new Error("the saved native lock list is too large");
        const stored: unknown = JSON.parse(text);
        if (!Array.isArray(stored) || stored.length > 100 || stored.some((entry) => typeof entry !== "string")) throw new Error("the saved native lock list is invalid");
        restored = stored.map((entry: string) => next.inspect(entry));
      }
      setLocks(restored);
      setSelected(restored[0]?.descriptor_hex);
      setSession(next);
    }).catch((failure: unknown) => { if (active) setError(problem(failure)); });
    return () => { active = false; generation.current += 1; };
  }, [storageKey]);

  const act = async (run: () => void | Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await run(); } catch (failure) { setError(problem(failure)); } finally { setBusy(false); }
  };
  const remember = (descriptor: NativeLockDescriptor) => {
    const next = [...locks.filter((entry) => entry.descriptor_hex !== descriptor.descriptor_hex), descriptor];
    if (next.length > 100) throw new Error("at most 100 native locks can be watched");
    localStorage.setItem(storageKey, JSON.stringify(next.map((entry) => entry.descriptor_hex)));
    setLocks(next); setSelected(descriptor.descriptor_hex); setCoins([]); setChosen(""); setReview(undefined); setFunding(undefined); setSigned(undefined);
  };
  const watch = async () => {
    if (!session || !lock) throw new Error("select a lock first");
    const token = ++generation.current;
    const read = await session.watch(tenrai, lock.descriptor_hex);
    if (token !== generation.current) return;
    setCoins(read); setChosen(read[0] ? `${read[0].outpoint.transaction_id}:${read[0].outpoint.output_index}` : "");
  };
  const backup = () => {
    const contents = encodeNativeLockBackup(network, locks.map((entry) => entry.descriptor_hex));
    const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "tenrai-native-lock-descriptors.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const importLocks = () => {
    if (!session) return;
    if (imported.length > 64 * 1024 || new TextEncoder().encode(imported).length > 64 * 1024) throw new Error("the descriptor backup is too large");
    const source = imported.trim();
    if (!source.startsWith("{")) { remember(session.inspect(source)); return; }
    const importedDescriptors = decodeNativeLockBackup(imported, network).map((entry) => session.inspect(entry));
    const next = new Map(locks.map((entry) => [entry.descriptor_hex, entry]));
    for (const descriptor of importedDescriptors) next.set(descriptor.descriptor_hex, descriptor);
    if (next.size > 100) throw new Error("at most 100 native locks can be watched");
    const all = [...next.values()];
    localStorage.setItem(storageKey, JSON.stringify(all.map((entry) => entry.descriptor_hex))); setLocks(all); setSelected(all[0]?.descriptor_hex); setImported("");
  };
  const build = async () => {
    if (!session || !lock) throw new Error("select a lock first");
    const parsed = /^([0-9a-f]{96}):(0|[1-9][0-9]{0,9})$/.exec(chosen);
    if (!parsed || Number(parsed[2]) > 0xffff_ffff) throw new Error("choose or enter an output as transaction-id:output-index");
    setFunding(undefined); setSigned(undefined);
    setReview(await wallet.reviewNativeLockSpend(session,tenrai, { descriptorHex: lock.descriptor_hex, branch, preimageHex: preimage, destination, outpoint: { transaction_id: parsed[1]!, output_index: Number(parsed[2]) } }));
  };
  const submit = async () => {
    if (funding) {
      if (asks(funding.amount + funding.fee)) await checkPassword(password);
      const retry = fundingAttempted;
      setFundingAttempted(true);
      try {
        const receipt = retry ? await wallet.retryPublic(tenrai, funding.transactionId) : await wallet.submit(tenrai, funding);
        const receiptId = "transaction_id" in receipt ? receipt.transaction_id : receipt.transactionId;
        if (receiptId !== funding.transactionId) throw new Error("submission receipt changed the transaction id");
        track("Fund native lock", [funding], (entry) => -(entry.amount + entry.fee));
        setNotice(`Submitted ${funding.transactionId}`); setFunding(undefined); setFundingAttempted(false); refresh(); return;
      } catch (failure) {
        salvage("Fund native lock", failure, (entry) => -(entry.amount + entry.fee));
        setNotice(`Funding may have reached the node. Retry sends the same transaction ${funding.transactionId}.`);
        throw failure;
      }
    }
    if (!review || !session) throw new Error("review a spend first");
    if (asks(review.inputAmount)) await checkPassword(password);
    if (!/^(0|[1-9][0-9]*)$/.test(keyIndex) || Number(keyIndex) > 0x7fff_ffff) throw new Error("invalid key index");
    const firstAttempt = signed === undefined;
    const exact = signed ?? await wallet.prepareNativeLockSpend(session, review, Number(keyIndex), keyBranch);
    setSigned(exact);
    try {
      const receipt = firstAttempt ? await wallet.submit(tenrai, exact) : await wallet.retryPublic(tenrai, exact.transactionId);
      const receiptId = "transaction_id" in receipt ? receipt.transaction_id : receipt.transactionId;
      if (receiptId !== exact.transactionId) throw new Error("submission receipt changed the transaction id");
    } catch (failure) {
      salvage(`Native lock ${review.branch}`, failure, () => 0n);
      setNotice(`The submission may have reached the node. Retry sends the same transaction ${exact.transactionId}.`);
      throw failure;
    }
    track(`Native lock ${review.branch}`, [exact], () => 0n);
    setNotice(`Submitted ${exact.transactionId}. Claim preimages are public on chain.`);
    setReview(undefined); setSigned(undefined); setPreimage(""); setPassword("");
    try { await watch(); } catch (failure) { setError(`Submitted; refreshing locked outputs failed: ${problem(failure)}`); }
    refresh();
  };

  return <Dialog title="Native locks and atomic swaps" onClose={onClose}>
    <p>Unlocking uses finalized cut heights. Keep a descriptor backup: the recovery phrase alone does not recover these addresses. Claims reveal the preimage publicly.</p>
    <p>For each nondefault owner, claim or refund key you own, also record its wallet account, receive/change branch and index with your private recovery data. Importing a descriptor restores the conditions; it does not discover key paths. Restore using the matching wallet account and keep its recovery phrase and passphrase separately.</p>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <fieldset disabled={busy || !session || !!review || !!funding}><legend>Create a lock</legend>
      <label>Type <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="timelock">Timelock</option><option value="hashlock">SHA-256 hashlock</option><option value="htlc">HTLC with refund</option></select></label>
      <NativeLockNotice type={kind} />
      <label>{kind === "htlc" ? "Claim address" : "Owner address"}<input value={owner} onChange={(event) => setOwner(event.target.value)} /></label>
      {kind === "htlc" && <label>Refund address<input value={refund} onChange={(event) => setRefund(event.target.value)} /></label>}
      {kind !== "hashlock" && <label>{kind === "timelock" ? "Unlock cut height" : "Refund cut height"}<input inputMode="numeric" value={height} onChange={(event) => setHeight(event.target.value)} /></label>}
      {kind !== "timelock" && <><label>SHA-256 hash, 32 bytes hex<input value={hash} onChange={(event) => setHash(event.target.value)} /></label><SecretForm><label>{kind === "htlc" ? "HTLC preimage to hash, exactly 32 bytes hex" : "Hashlock preimage to hash, 1–64 bytes hex"}<input type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} /></label></SecretForm><button type="button" onClick={() => void act(() => { if (kind === "htlc" && secret.length !== 64) throw new Error("HTLC preimages must be exactly 32 bytes of hex"); if (session) setHash(session.hash(secret)); })}>Hash preimage</button><button type="button" onClick={() => void act(() => { const value = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join(""); setSecret(value); if (session) setHash(session.hash(value)); })}>Generate 32-byte preimage</button><button type="button" disabled={!secret} onClick={() => void act(async () => { await navigator.clipboard.writeText(secret); setNotice("Preimage copied. Keep it private until claiming and back it up separately from the public descriptor."); })}>Copy private preimage</button></>}
      <button type="button" onClick={() => void act(() => { if (session) remember(session.create(kind === "timelock" ? { type: kind, owner_address: owner, unlock_height: height } : kind === "hashlock" ? { type: kind, owner_address: owner, hash_hex: hash } : { type: kind, claim_address: owner, refund_address: refund, hash_hex: hash, refund_height: height })); })}>Create and watch</button>
      <label>Import descriptor hex or JSON backup<textarea value={imported} onChange={(event) => setImported(event.target.value)} maxLength={65536} /></label><button type="button" onClick={() => void act(importLocks)}>Import and watch</button><button type="button" onClick={backup} disabled={locks.length === 0}>Export descriptor backup</button>
    </fieldset>
    <fieldset disabled={busy || !session || !!review || !!funding}><legend>Watched locks</legend>
      <label>Lock<select value={selected ?? ""} onChange={(event) => { generation.current += 1; setSelected(event.target.value); setCoins([]); setChosen(""); }}><option value="">Choose a lock</option>{locks.map((entry) => <option key={entry.descriptor_hex} value={entry.descriptor_hex}>{entry.type}: {entry.address}</option>)}</select></label>
      {lock && <><NativeLockNotice type={lock.type} /><Facts rows={[["Address", lock.address], ["Descriptor", lock.descriptor_hex], ...(lock.owner_address ? [["Owner address", lock.owner_address] as [string, string]] : []), ...(lock.claim_address ? [["Claim owner", lock.claim_address] as [string, string]] : []), ...(lock.refund_address ? [["Refund owner", lock.refund_address] as [string, string]] : []), ...(lock.unlock_height ? [["Unlock height", lock.unlock_height] as [string, string]] : []), ...(lock.refund_height ? [["Refund height", lock.refund_height] as [string, string]] : []), ...(lock.hash_hex ? [["Hash", lock.hash_hex] as [string, string]] : [])]} /><button type="button" onClick={() => void act(watch)}>Refresh locked outputs</button>
      <label>Fund amount, TRAI<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" /></label><button type="button" onClick={() => void act(async () => { setReview(undefined); setSigned(undefined); setFunding(await wallet.prepare(tenrai, { to: lock.address, amount: parseTrai(amount) })); })}>Review funding</button>
      <label>Unspent output<select value={chosen} onChange={(event) => setChosen(event.target.value)}><option value="">Choose an output</option>{coins.map((coin) => { const id = `${coin.outpoint.transaction_id}:${coin.outpoint.output_index}`; return <option key={id} value={id}>{formatTrai(BigInt(coin.amount))} TRAI — {id}</option>; })}</select></label>
      <label>Or enter a known output, transaction-id:output-index<input value={chosen} onChange={(event) => setChosen(event.target.value)} maxLength={107} /></label>
      <label>Branch<select value={branch} onChange={(event) => setBranch(event.target.value as typeof branch)}><option value="claim">Claim</option>{lock.type === "htlc" && <option value="refund">Refund</option>}</select></label><SecretForm><label>{branch === "refund" || lock.type === "timelock" ? "No preimage for this branch, leave empty" : lock.type === "htlc" ? "HTLC claim preimage, exactly 32 bytes hex" : "Hashlock claim preimage, 1–64 bytes hex"}<input type="password" autoComplete="off" value={preimage} onChange={(event) => setPreimage(event.target.value)} /></label></SecretForm><label>Destination<input value={destination} onChange={(event) => setDestination(event.target.value)} /></label><label>Signing key branch<select value={keyBranch} onChange={(event) => setKeyBranch(event.target.value as typeof keyBranch)}><option value="receive">Receive</option><option value="change">Change</option></select></label><label>Signing key index<input value={keyIndex} onChange={(event) => setKeyIndex(event.target.value)} inputMode="numeric" /></label><button type="button" onClick={() => void act(build)}>Review claim or refund</button></>}
    </fieldset>
    {(review || funding) && <section aria-label="Confirm native lock transaction"><Facts rows={[["Transaction", (review ?? funding)!.transactionId], ["Receive / fund", `${formatTrai((review ?? funding)!.amount)} TRAI`], ["Fee", `${formatTrai((review ?? funding)!.fee)} TRAI`], ...(review ? [["Branch", review.branch], ["Authority", review.authorityAddress], ["Destination", review.destination], ["Valid cut heights", `${review.validFrom}–${review.validUntil}`]] as [string, string][] : [])]} /><label>Wallet password when required<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><button type="button" disabled={busy} onClick={() => void act(submit)}>{signed || fundingAttempted ? "Retry same transaction" : "Confirm and submit"}</button><button type="button" disabled={busy || !!signed || fundingAttempted} onClick={() => { setReview(undefined); setFunding(undefined); }}>Cancel review</button></section>}
  </Dialog>;
}
