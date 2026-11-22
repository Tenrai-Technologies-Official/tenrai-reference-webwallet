# Native locks

Protocol 2 adds version 1 native lock descriptors. The protocol WASM validates the
canonical descriptor and computes its profile 3 address. All authorities are direct
ML-DSA-65 addresses. Timelocks use finalized cut heights, never a device clock.

```ts
import { NativeLockSession } from "@tenrai/sdk/wallet";

const locks = await NativeLockSession.fromManifest(await client.transactions.manifest());
const descriptor = locks.create({
  type: "htlc",
  claim_address: wallet.address(),
  refund_address: refundAddress,
  hash_hex: locks.hash(preimageHex),
  refund_height: "200000",
});
// Save/export descriptor.descriptor_hex before funding. The phrase alone cannot
// reconstruct descriptors. Keep the preimage private and back it up separately.
const funding = await wallet.prepare(client, { to: descriptor.address, amount: atoms });
// Display funding's amount, fee and transaction id, and obtain user confirmation.
await wallet.submit(client, funding);
```

Other creation requests are `{type:"timelock", owner_address, unlock_height}` and
`{type:"hashlock", owner_address, hash_hex}`. Heights are canonical decimal strings;
the hash is 32 bytes of lowercase SHA-256 hex. Standalone hashlocks accept
preimages of 1–64 raw bytes as hex. HTLC claims require exactly 32 bytes, matching
the secret-size condition used by common atomic-swap contracts. Generate a fresh,
cryptographically random 32-byte preimage for each new swap.

Use `locks.inspect(descriptorHex)` to import recovery data and
`await locks.watch(client, descriptorHex)` to read the locked outputs. These outputs
are separate from the ordinary wallet balance and coin selection. Watch walks are
bounded and require a consistent finalized snapshot.
Spending a known outpoint uses its finalized membership proof directly, so dust
outputs at the same address cannot force a full address scan before a spend.
Both web wallets export the public container `{format:1, network, descriptors}`
with canonical descriptor hex strings. They also read legacy `version:1` backups;
exports never contain preimages or private keys. Preserve this public recovery
file separately from private recovery data.
For every nondefault owner, claim or refund key you own, retain the wallet account,
receive/change branch and index alongside the corresponding recovery phrase and
passphrase. Descriptor import restores the conditions, not automatic key-path
discovery; redemption needs the matching wallet account and derivation path.

```ts
const outputs = await locks.watch(client, descriptor.descriptor_hex);
const review = await wallet.reviewNativeLockSpend(locks, client, {
  descriptorHex: descriptor.descriptor_hex,
  branch: "claim", // "refund" for an HTLC after its refund height
  preimageHex, // empty for a timelock claim or HTLC refund
  outpoint: outputs[0]!.outpoint,
  destination: wallet.address(),
  maxFee: maxFeeAtoms, // optional upper bound
});
// Display the immutable review: authority, branch, destination, amount, fee,
// outpoint, validity heights and transaction id. Claiming publishes the preimage.
const signed = await wallet.prepareNativeLockSpend(locks, review, keyIndex, "receive");
await wallet.submit(client, signed);
```

The wallet authenticates the reported quorum certificate against its local Genesis,
then verifies and decodes the selected output in Rust. It checks that output again
after confirmation, before signing, and durably records observed finality before
exporting a signature. The selected key must own the descriptor branch.
A descriptor-only session cannot authorize a spend.

A certificate proves finalization, not that a peer disclosed the latest cut.
Claims need a live honest node view and a finalization/latency buffer before
the refund height. A peer can withhold newer cuts and replay an older valid
certificate. Sharing a claim wire reveals the preimage even if it remains
unconfirmed or is rejected.

Claims have `valid_until_height < refund_height`; refunds have
`valid_from_height >= refund_height`. A timelock requires
`valid_from_height >= unlock_height`. Actual execution still checks the signed
inclusive validity interval. Leave a practical finality/latency margin between
the deadlines of different chains when arranging a swap.

A spend review belongs to the session that created it. Re-signing that same review
with the branch key returns the cached exact wire. If a submission answer is lost, query its transaction
id and retry that same wire. Do not build a replacement while its outcome is
unknown. No private keys or preimages are sent to the server before submission.

`prepareNativeLockSpend` integrates the native input with the ordinary wallet's
input reservation and retry handling. `wallet.signNativeLockSpend(...)` returns the wire for a
sender of your own once the input is held in the durable journal.

Optional automatic refunds belong to the wallet daemon's authenticated local RPC,
not the public node API or this browser SDK. They require a daemon started with
`--auto-refund`, an unlocked wallet and a registered known HTLC outpoint with its
public descriptor and maximum fee in integer atoms. The refund destination is the
committed refund owner. Keep that daemon running and monitor watch status;
closing a web wallet does not activate or maintain monitoring. The existing
browser SDK refund flow remains an explicit signed transaction.

Fresh automatic attempts use a daemon-local cap of 200 cuts, further restricted by
the authenticated manifest and protocol limits. Existing signed intervals remain
unchanged, including earlier 1,800-cut attempts. Replacing one requires finalized
height strictly past its exact signed expiry and an authenticated membership proof
bound to finalized state that the exact funding outpoint remains unspent. Missing
status or elapsed wall-clock time alone does not permit replacement. Ledger and
manual spend validity limits are unchanged.
