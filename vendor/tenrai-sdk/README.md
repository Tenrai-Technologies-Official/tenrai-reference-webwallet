# Tenrai SDK

Client for the Tenrai node API: every REST route, the three WebSocket streams, signed answers and a
wallet that builds and signs transfers. Works with a node directly and with the Tenrai API
(`https://api.tenrai-technologies.org`), from TypeScript and plain JavaScript, in Node.js 22.12+ and
browsers.

```
npm install @tenrai/sdk
```

## Quick start

Read a balance:

```js
import { TenraiClient, formatTrai } from "@tenrai/sdk";

const tenrai = new TenraiClient();
const { balance } = await tenrai.address.balance("trai1…");
console.log(`${formatTrai(balance)} TRAI`);
```

Send TRAI and wait until it is final:

```js
import { TenraiClient, parseTrai } from "@tenrai/sdk";
import { Wallet } from "@tenrai/sdk/wallet";

const tenrai = new TenraiClient();
const wallet = await Wallet.fromMnemonic(process.env.TENRAI_MNEMONIC, { network: "mainnet" });
const sent = await wallet.send(tenrai, { to: "trai1…", amount: parseTrai("2.5") });
const final = await tenrai.transactions.waitForFinal(sent.transactionId, { validUntil: sent.validUntil, wireHex: sent.wireHex });
console.log(final.lifecycle, final.failure ?? "", final.finalized_cut?.height ?? "");
```

Follow a transaction:

```js
const status = tenrai.transactions.watch(transactionId);
status.on("status", (update) => console.log(update.lifecycle));
status.on("final", (update) => console.log("final in cut", update.finalized_cut?.height));
```

Follow every finalized cut, resumed after reconnects:

```js
const events = tenrai.events({ afterHeight: lastHeight });
events.on("cut", (event) => save(event.cut.height));
```

The full reference is in [docs/api](docs/api/README.md); runnable examples are in [examples](examples).

## Connect

```js
const api = new TenraiClient();                                                  // https://api.tenrai-technologies.org
const node = new TenraiClient({ url: "http://127.0.0.1:28701", target: "node" }); // your own node
```

| Option | Default | |
| --- | --- | --- |
| `url` | `https://api.tenrai-technologies.org` | Node or Tenrai API; a path prefix such as `/tenrai` is kept |
| `target` | `"api"` | `"api"` for the Tenrai API, `"node"` for a node; sets the limits below |
| `timeoutMillis` | `15000` | Per request |
| `retries` | `2`, `5` after `429` or `503` | See [Errors and rate limits](#errors-and-rate-limits) |
| `requestsPerSecond` | from `target` | `0` turns the limit off |
| `maxConcurrent` | from `target` | |
| `headers` | | Sent with every request |
| `maxResponseBytes` | 32 MiB | |
| `verify` | | `signedResponses(...)`, see [Signed answers](#signed-answers) |
| `fetch` | `globalThis.fetch` | |
| `WebSocket` | `globalThis.WebSocket` | For example `WebSocket` from the `ws` package |
| `reconnect` | `{ minDelayMillis: 500, maxDelayMillis: 30000 }` | Socket reconnect delays, with jitter |

| Limit | `target: "api"` | `target: "node"` |
| --- | --- | --- |
| REST requests | 10 per second, bursts of 20, 4 at a time | none |
| Submissions | 1 at a time, 2 per second | none |
| `/v1/ws` frames | 8 per second | 40 per second |
| `/v1/ws` requests | 4 at a time | 8 at a time |

Every REST method takes `{ signal }` to cancel it. From a web page, a node answers only the origins its
operator admits (`browser_origins`), none by default.

## REST

| Method | Route |
| --- | --- |
| `health()` | `GET /health` |
| `node.info()`, `.status()`, `.identity()`, `.sync()`, `.historySync()`, `.peers()`, `.storage()` | `GET /v1/node/*`, `GET /v1/storage` |
| `chain.head()`, `.genesis()`, `.issuance()`, `.epoch()`, `.daa()`, `.rates()` | `GET /v1/chain/*` |
| `economics.supply()`, `.emission()` | `GET /v1/economics/supply`, `/emission` |
| `economics.miningEstimate(hashesPerSecond)`, `.stakingEstimate(atoms)` | `GET /v1/economics/estimate/*` |
| `fees.quote()`, `.estimate()` | `GET /v1/fees/*` |
| `mempool.info()`, `.transactions({ limit })` | `GET /v1/mempool`, `/v1/mempool/transactions` |
| `mempool.pending(addresses)` | `POST /v1/mempool/pending` |
| `work.pool()`, `network.mining()` | `GET /v1/work/pool`, `/v1/network/mining` |
| `transactions.submit(wireHex)` | `POST /v1/transactions` |
| `transactions.statuses(ids)` | `POST /v1/transactions/status` |
| `transactions.manifest()`, `.recent({ limit })` | `GET /v1/transactions/manifest`, `/recent` |
| `transactions.get(id)`, `.status(id)` | `GET /v1/transactions/{id}`, `/status` |
| `transactions.compact(id)` | `GET /v1/transactions/{id}/compact`; local display data without canonical witnesses |
| `blocks.recent({ limit })`, `.get(id)` | `GET /v1/blocks/recent`, `/v1/blocks/{id}` |
| `cuts.list({ before, limit })`, `.get(height)` | `GET /v1/cuts`, `/v1/cuts/{height}` |
| `cuts.addresses(h)`, `.changes(h, page)`, `.transactions(h, page)`, `.blocks(h)` | `GET /v1/cuts/{height}/*` |
| `staking.validators(page)`, `.validator(id)`, `.uptime()`, `.validatorSlash(id)` | `GET /v1/staking/*` |
| `staking.validatorPositions(id, page)` | `GET /v1/staking/validators/{id}/positions` |
| `staking.positions(addresses, page)`, `.position(id)` | `POST /v1/staking/positions`, `GET /v1/staking/positions/{id}` |
| `address.balance(a)`, `.utxos(a, page)`, `.history(a, page)`, `.unbonding(a, page)` | `GET /v1/address/{address}/*` |
| `address.balances(list)`, `.utxoBatch(list)`, `.changes(list, afterHeight)` | `POST /v1/address/*` |
| `keys.registered(addresses)` | `POST /v1/keys/registered` |
| `proofs.utxos(anchor, outpoints)` | `POST /v1/proofs/utxos` |
| `proofs.keys(anchor, lockCommitments)` | `POST /v1/proofs/keys` |
| `privateTransfers.status()`, `.anchor()` | `GET /v1/private/status`, `/v1/private/anchor` |
| `privateTransfers.notes({ from, limit })`, `.records({ from, limit })` | `GET /v1/private/notes`, `/v1/private/records` |
| `privateTransfers.nullifiers({ fromHeight, limit })` | `GET /v1/private/nullifiers` |
| `privateTransfers.statements({ before?, limit? })` | `GET /v1/private/statements` |
| `privateTransfers.statement(digest)` | `GET /v1/private/statements/{digest}` |
| `privateTransfers.cutItems(height)` | `GET /v1/private/cuts/{height}` |
| `privateTransfers.submitRegistration(hex)`, `.submitTransfer(hex)`, `.submitEnter(hex)`, `.submitExit(hex)` | `POST /v1/private/registrations`, `/transfers`, `/enters`, `/exits` |

Batch routes take up to 64 addresses, `statuses` up to 1024 ids, `proofs.utxos` up to 8 outpoints,
and `proofs.keys` up to 5 direct ML-DSA-65 lock commitments.
Answers are the node's JSON documents, typed; amounts in them are atom strings.

### Key-registry proofs

`proofs.keys(anchor, lockCommitments)` returns membership or absence proofs for exactly the given lock
commitments at the given cut; a membership entry carries the registered public key, an absence entry has
`record: null`. The proofs bind to `anchor.state_root`, not to the cut's finality: authenticate the cut
and its finality yourself, for example with your own validating node, before relying on them. A response
signature authenticates the server's answer, not the chain state behind it.

### Private transfers

Private transfers (TSP-2) stay off until a rule set activates them; `privateTransfersUsable(status)`
says whether a wallet may offer them (active, measured proofs within the limits, security qualification
`internally_qualified` or `complete`).

A wallet spends its notes through `wallet.privateNotes(client, { store })`, with a prover on the device
that runs it. No key, note or witness leaves the device, and no proving server exists to ask:

```ts
import { parseTrai } from "@tenrai/sdk";
import { Wallet, localProver } from "@tenrai/sdk/wallet";

const notes = await wallet.privateNotes(client, { store });
const prover = localProver({ folder: "/prover/", path: "./tenrai-tsp2-prove" });
const quote = await notes.planRegistration({
  maximumFeeAtoms: parseTrai("0.01"),
  change: { branch: "receive", index: 0 },
});
// Review quote.feeAtoms, changeAddress and inputs before approving payment.
const registration = await notes.register(quote);
await client.transactions.waitForFinal(registration.digest, { validUntil: registration.validUntil });
await notes.refresh();
await notes.enter({ amount: parseTrai("100") }, { prover });
await notes.transfer({ to: privateAddress, amount: parseTrai("10") }, { prover, onProgress });
await notes.exit({ to: address, notes: [leaf] }, { prover });
const outcomes = await notes.check(finalizedHeight);
```

`localProver` takes `browserProver` in a page and `nativeProver`, the program `tenrai-tsp2-prove`, under
Node; any object with `prove(input, { signal, onProgress })` serves. `proofEstimate(kind, { native, threads, lastSeconds })`
tells how long a proof takes here, by the threads or by the last proof on this device. In a page the prover runs in a Web
Worker, one per proof, from the package's `prover` folder, which the page hosts as it is and whose files the
SDK checks against their pinned hashes. Threads need the page served with
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`; without them the
proof runs on one thread, in minutes. A proof takes up to about 3.5 GiB of memory in a browser.

The original proven frame is durably stored before submission and retains its notes and ENTER inputs
across lost replies, refusals, restarts and `notes.close()`. A permanent refusal sets `needs_review`;
`notes.retry(digest)` retries those same bytes. `check` releases reservations only after WASM verifies
exact statement inclusion, or verifies unused original inputs after expiry. HTTP status and caller-provided
height alone cannot finalize or expire a payment. Historical proofs request one bridge link at a time,
continuing verified progress across bounded checks. Missing history keeps the payment reserved for review.

Restore the same private store before any transparent spending, including sessions where the private tab
is disabled. The factory can await this without fetching notes, registration or proofs:

```ts
const wallet = await Wallet.fromMnemonic(mnemonic, {
  network: "mainnet",
  privateStore: (owner) => ({ store: stores.forWallet(owner) }),
});
const notes = await wallet.privateNotes(client); // reuses the restored store
```

For an existing wallet call `await wallet.restorePrivatePending({ store })` before spending. A damaged
pending record fences public planning and submission until restoration succeeds. The SDK cannot discover
an application's external store unless it supplies one. `read("sends")` returns null only when absent;
unreadable existing data must throw, and `write("sends", bytes)` must resolve only after durable commit.
State/mark scan caches remain rebuildable. A cancelled or failed proof that produced no stored frame
leaves no executable payment.

`owner` provides the network, account, full derived address and display fingerprint. Use the full account
identity and configured chain for storage keys; the human fingerprint has only 32 bits. Persistent stores
must implement `acquireSendsLease()` with exclusive ownership across tabs/processes and a `release()`
handle. A second owner fails before restoration or spending; there is no time-based expiry. The wallet
retains that lease across private-tab closure and rejects switching stores until it closes.
`await wallet.close()` waits for outstanding writes/submission continuations and lease release;
`await notes.close()` stops that scan while its Wallet retains the store lease.

| | |
| --- | --- |
| Pages | Up to 512 notes or records; pass `next` as `from`. A node that does not hold the rows from `from` answers 404 |
| Submissions | Verified before the receipt; the receipt names the statement digest, for a paid registration the complete funded frame ID |
| Fees | `status.fees.transfer_fee` covers any transfer, ENTER or EXIT at the schedule's limits |
| EXIT outputs | Source `private_exit`; their transaction ID is the EXIT's statement digest |
| ENTER inputs | Spent by a `private_enter` transaction, which runs only in the private stage of a cut |

### Validators

| Field | |
| --- | --- |
| `state` | Whether the validator requested exit |
| `is_active`, `inactive_reasons` | Whether it can serve now, and the protocol reasons when it cannot |
| `last_attendance_epoch`, `jailed_until_epoch` | Attendance and jail epochs, when present |
| Commission | 0–1000 bps in 10-bps steps; a scheduled rate names its activation epoch and height |
| `validatorSlash(id)` | The retained finalized slash record with its evidence and burn totals |

## Pagination

Paged routes return `next_cursor`; `pages` walks them. A cursor that is not a string is typed at the
parameter, such as the cut list's `next_before`:

```ts
import { pages } from "@tenrai/sdk";

for await (const page of pages((cursor) => tenrai.address.history(address, { cursor }))) {
  console.log(page.events.length);
}
for await (const page of pages((before?: number) => tenrai.cuts.list({ before }), (page) => page.next_before)) {
  console.log(page.cuts.length);
}
```

## Wallet

`@tenrai/sdk/wallet` builds and signs transfers with the Tenrai protocol rules compiled to
WebAssembly, the same code the node and the other Tenrai wallets run. Keys stay inside the WASM.

```js
import { Wallet } from "@tenrai/sdk/wallet";

const wallet = await Wallet.fromMnemonic(phrase, { network: "mainnet" });
wallet.address(0);                                 // first receiving address
const { atoms } = await wallet.balance(tenrai);    // all used addresses
const transfer = await wallet.prepare(tenrai, { to, amount }); // review: nothing held, no signed bytes
const sent = await wallet.send(tenrai, { to, amount, payload: "invoice 42" });
const payout = await wallet.send(tenrai, { payments: [{ to: alice, amount: a }, { to: bob, amount: b }] });
wallet.close();
```

| Call | |
| --- | --- |
| `Wallet.fromMnemonic(phrase, { network, passphrase?, account? })` | 24-word recovery phrase |
| `Wallet.generate({ network })` | A new wallet and its phrase |
| `address(index, branch?)` | `receive` or `change` address |
| `balance(client)` | Scans the addresses and sums their finalized balances and unspent outputs: the first scan checks 100 past the last used one, later ones 20 |
| `rescan(client, { depth? })` | Checks `depth` addresses past the last used one (default 1000, at most 10000), for coins further out |
| `usedAddresses`, `rememberUsed(used)` | The highest used index per branch, to keep with the wallet and hand back in the next session |
| `newAddress()` | The receiving address after every used and handed-out one; scans keep looking 20 past it |
| `lastIssued`, `rememberIssued(index)` | The last handed-out index (0, the main address, before any), to keep and hand back like `usedAddresses` |
| `owns(address)` | Whether an address is the wallet's: any one a scan, `address` or `newAddress` derived |
| `pathOf(address)` | Branch and index of such an address, else undefined |
| `activity(client, { limit? })` | Finalized activity, one entry per transaction with `received` and `spent`, newest first |
| `prepare(client, request)`, `send(client, request)` | `{ to, amount }` or `{ payments: [{ to, amount, payload? }, …] }`, plus `priority?`, `feePerMass?`, `payload?`; `payload` is one for all recipients, a payment's `payload` is that recipient's own, never both |
| `maxSendable(client, { to?, payload?, priority?, feePerMass? })` | The most one transfer can send: the largest spendable outputs up to the input limit, less the fee; `prepare` with exactly that leaves out the change |
| `submit(client, prepared)` | Sends a transfer from `prepare` as it is, for a confirm step in between; its inputs stay held until it is final or certified unused |
| `exportSigned(prepared)` | The signed bytes of a transfer from `prepare`, after its inputs are held in the durable journal; the wallet does not send it |
| `resend(client)` | Sends transfers on their way again while the node does not know them |
| `openTransfers()`, `keepOpen(transfers)` | The transfers on their way, to keep across a restart of the program |
| `sweep(client, { to })` | Everything spendable to one address, up to 64 transfers per call |
| `burn(client, { amount })` | Pays the amount to `burnAddress(network)`, which no key can spend; the node takes it out of the supply. It cannot be undone |
| `compound(client, { above, atLeast })` | Merges the outputs of each address holding more than `above` (default 1), or whose outputs besides the largest reach `atLeast` atoms, up to 64 transfers per call; the way out of `compound-needed` |
| `mergeFor(client, request, { confirm?, timeoutMillis? })` | For a `send` request whose amount needs more outputs than one transfer spends: compounds them first, each address into outputs of its own, and waits until that is final; `confirm` gets the outputs, transfers and fee of every round first and may say no. Then `prepare` or `send` fits |
| `autoCompound(wallet, client, { above \| atLeast, everyMillis })` | Runs `compound` every minute (or `everyMillis`) while it runs and returns the stop function; `onSent` and `onError` report each round |
| `outputs(client)` | The unspent outputs it can spend now, largest first, with address, amount and the height that created them |
| `bond(client, { validatorId, amount, owner? })` | Stakes at least `minimum_delegation`; checks the target validator's finalized acceptance and capacity first. `owner` gets the rewards, `address(0)` by default |
| `unbond(client, { positionId })`, `withdraw(client, { positionId })` | Starts unbonding; brings the stake of a `withdrawable` position back |
| `positions(client)` | The wallet's stake positions |
| `validatorConsensusPublicKey(index?)` | ML-DSA-65 public key at a reserved validator change index |
| `registerValidator(client, request)` | Builds a self-bond registration with the owner signature and new-key proof; use the finalized `minimum_self_bond` and a canonical overlay endpoint |
| `exitValidator(client, { validatorId })`, `rotateValidator(client, request)` | Schedules owner-authorized exit or key/endpoint rotation from the finalized validator nonce |
| `updateValidatorEndpoint(client, request)` | Schedules a delayed overlay endpoint replacement using the active consensus key's possession proof |
| `scheduleValidatorCommission(client, { validatorId, commissionBps })` | Schedules a delayed commission update; rates are 0–1000 bps in 10-bps steps |
| `setStakeRewardAddress(client, { positionId, rewardAddress })` | Changes one position's finalized reward lock |
| `heartbeatValidator(client, { validatorId, consensusKeyIndex? })` | Signs the next heartbeat with the registered consensus key; no separate node endpoint is used |
| `multisigMemberPublicKey(index?, branch?)` | Public ML-DSA-65 key for a 2-of-3 or 3-of-5 descriptor |
| `signMultisigPackage(session, package, reviewedTemplate, index?, branch?)` | Adds this wallet's signatures only after the exact reviewed template digest is supplied |
| `isValidAddress(text, network)` | Checks an address by the protocol rules |
| `payloadText(payload)`, `isSafeText(text)` | A received payload (`payload_hex` of `transactions.get` or bytes) as text when it is UTF-8 and safe to show, else null for a hex display; text payloads must pass `isSafeText` to be sent |
| `recipientPayloads(payload)`, `encodeRecipientPayloads(entries)` | The payloads per recipient in a transaction's payload, `[{ output, payloadHex, text }]` with `output` the index in `outputs`, or null for one payload for all; the layout is `protocol/recipient-payloads-v1.md` in the node repository |
| `paymentRequest(address, network, amount?, payload?)`, `parsePaymentRequest(text, network)` | The payment URI for a QR code, with `?amount=` and `payload=` when asked for, and reading back an address, payment URI or request as `{ address, amount, payload }`; any other parameter, or one twice, is refused |
| `isRequestPayload(text)`, `MAX_REQUEST_PAYLOAD_BYTES` | Whether text may be a request's payload: letters, digits, spaces and `. , : ; - _ / # + ( ) ! ? % @ * &`, no outer spaces, at most 128 bytes, so a QR code cannot carry markup or invisible characters into a payment |
| `proveAddress(request, { now? })` | Answers an [address proof request](#address-verification-and-ownership) for an address the wallet derived, up to 100 past the last used or handed-out one |

`sweep` and `compound` return one `SentTransfer` per transfer. A transaction spends at most 8 outputs,
so a wallet with thousands of them, such as a miner's, goes in rounds: 64 full answers mean there is
more, and the next call picks up the rest. Run them again as well to continue after a failure.
One transfer pays up to the manifest's output limit minus one recipients, the last output being change.

The fee follows `/v1/fees/estimate` (`priority` `minimum`, `normal` or `priority`); an automatic fee
above 4 times the network minimum, 16 times at `priority`, needs an explicit `feePerMass`. Change goes
to a fresh change address. Outputs spent by a sent transfer, also one still being sent, are not chosen
again until it settles or expires. The wallet refuses a node on another network. Failures throw
`TenraiWalletError` with a `code`: `insufficient`, `compound-needed`, `fee-ceiling`, `fee-unsettled`,
`too-heavy`, `too-many-outputs`, `wrong-network`, `invalid`, `rejected` or `unconfirmed`.

When a submission fails, `send` asks for the transaction's status. A later refusal or unknown status
cannot disprove an earlier executable copy. An unresolved attempt throws `unconfirmed`, keeps its exact
signed bytes and reserves its original inputs; it never plans a replacement payment automatically.
`details.transactionId`, `details.wireHex` and `details.transfer` name the transaction,
and a `sweep` or `compound` that stops part way lists what it sent before in `details.sent`. Its outputs stay
held.

A node can forget transactions held only in its mempool after a restart. `resend` retries the exact
original bytes, at most every 30 seconds, while the transaction remains executable. Reported final
status or expiry can pause resends; verified reconciliation owns the release of its reservations.
A managed wallet restores its sealed public journal before submission. `openTransfers()` and
`keepOpen` also support offline inspection of retained artifacts. Claim wires can contain an HTLC
preimage before broadcast; persistent providers keep these artifacts sealed under the full root.

Retained transfers expose `needsReview` after an uncertain attempt or restoration. A reported expiry,
final status or missing input can pause automatic resends (`resendPaused`) while their original frames
and holds remain available for verified reconciliation. Raw tip/status/index metadata does not release
an uncertain transfer.

Managed `Wallet` submissions and `exportSigned` require a durable public journal and outcome store;
without one, `prepare` still reviews. Raw `client.transactions.submit` leaves persistence to the
application; it does not use the managed wallet's reservations or outcome archive.

`reconcilePublic(client)` verifies the current finalized head and every original input's presence or
absence. After the signed validity window, proven unused inputs release an expired payment. Spent
inputs with no authenticated execution receipt close its active hold as `unknown`, preserving the
original artifact; they do not prove delivery or failure. `unknownPublicOutcomes()` and
`unknownPublicOutcome(id)` page and read these retained outcomes. Private notes expose the corresponding
`unknownOutcomes()` and `unknownOutcome(id)` methods. The closure's `closedAt.height` is the verified
current coverage height, not an execution height. Do not automatically create a replacement payment
for an unknown outcome.

Account stores supply an `outcomes: OutcomeStore` for this encrypted archive. Browsers use strict
durable IndexedDB by default; Node applications can wrap a dedicated disk SQLite connection with
`sqliteOutcomeStore(database, namespace)`. The archive shares the account session lease, inserts
immutable records before active holds are removed, and pages at most 128 identities per call. Each
record is bounded to 5 MiB; total disk usage grows with retained ambiguous artifacts. Keep this store
with the payment journal when backing up or restoring.


A factory's captured `privateStore` options can also supply `publicTransfers: PublicTransfersStore`.
It shares the same exclusive account-session lease. Its authoritative `chainId` identifies the configured
chain; `read()` returns only absent or the exact sealed bytes, and `write(bytes)` must resolve only after
strict durable commit. The wallet seals the record under the full root, genesis, account and record ID,
validates each original wire's transaction ID, inputs and validity with the native codecs, and restores
holds before the factory returns. It commits the original artifact before the first public POST and
persists review/pause transitions. A damaged mandatory record stops spending without replacing its bytes.

When the record is absent, optional `checkAbsent()` runs under the same lease before an empty record is
committed. Use it to reject unidentified earlier payment journals instead of treating them as new wallets.
The reference wallet supplies this check for its earlier browser history and exposes opaque recovery
exports. Its independent presence marker also refuses a missing record that was previously initialized;
this detects a surviving marker, not deletion or rollback of all local browser storage. `retryPublic(client, id)` sends a retained original artifact; `submitSignedPublic` also routes
already signed native or threshold artifacts through the same durable path. Display caches must not
call `keepOpen` when this provider is configured.

The WASM loads by itself in Node.js and in browsers. When a bundler moves `tenrai_wasm_bg.wasm`, pass
its URL to `loadProtocolRules(url)` before the first wallet call; the binary must match the pinned hash.

### Transparent multisig

`MultisigSession.fromManifest(manifest)` keeps an offline threshold package bound to one network,
chain and rules hash, for transparent payments: `createPackage`, `review`, `signingMessages` with
`wallet.signMultisigPackage`, `combine` and `complete`. A signer passes the exact `templateDigest` from
`review`; combining refuses packages with another template, descriptor, network or manifest.

| Step | Rule |
| --- | --- |
| Before signing | Show every field of `session.review(package)`: recipients, amounts, fee, inputs, validity range, descriptor, `witnessProfile` and template digest |
| Witness profile | `threshold-ml-dsa-65-inline` or `threshold-ml-dsa-65-referenced`; refuse any other |
| Partial packages | Hold no private key; keep them as files or encrypted local documents |
| Submit | The bytes of `session.complete(package)`, only when `review.complete` is true |

## Streams

### Finalized cuts

`events()` opens `/v1/events`. Every cut arrives once and in height order. After a lost connection
the stream reconnects with `?after_height=` and the server replays what was missed, up to one hour.

| Event | |
| --- | --- |
| `checkpoint` | First frame of each connection: the node's finalized head |
| `cut` | One finalized cut with its rewards |
| `resync` | `after_height` was older than the replay reaches; the stream goes on after `finalized` |
| `open`, `close`, `error` | Connection state; `close` carries `retryInMillis` |

`lastHeight` is the height of the last delivered cut; store it to resume after a restart.

### Subscriptions

`live()` opens `/v1/ws`. Subscriptions come back after a reconnect and then call `onResync`,
because events may have been missed in between. A subscription the server refuses for a moment is
tried again; a final refusal goes to `onError`, or to the socket's `error` event without one.

```js
const live = tenrai.live();
live.subscribe({
  topic: "addresses",
  addresses: [address],
  onEvent: (event) => console.log(event.type, event.data),
  onResync: () => reloadBalance(),
});
const head = await live.request("/v1/chain/head");
```

| Topic | Events |
| --- | --- |
| `cuts` | `cut_finalized` |
| `blocks` | `block_accepted` |
| `mempool` | `mempool` |
| `rates` | `rates` |
| `sync` | `sync` |
| `transaction` | `transaction_status`, takes `transactionId` |
| `addresses` | `address_changed`, `mempool_tx_seen`, `mempool_tx_removed`, takes up to 64 `addresses` |
| `mempool_transactions` | `mempool_transaction`, `mempool_transaction_removed`, if the server offers it |

Equal subscriptions share one on the server. One socket holds 64 subscriptions and 512 addresses;
`request` reads the public GET routes. `live({ framesPerSecond })` overrides the frame limit of the target.

### Transaction status

`transactions.watch(id)` opens `/v1/transactions/{id}/status/stream` and closes itself once the status
is final. A status is final by the node's rule, exported as `isFinal`: `finalized`, or `failed` with
`conflict` or `expired` in a finalized cut.

`waitForFinal(id, { validUntil, timeoutMillis })` asks over REST first. All waits of a client share
`/v1/ws` sockets and one batched status poll, which also runs when the runtime has no WebSocket. Once
the chain has passed `validUntil` without executing the transaction, it can never execute, and the wait
resolves as `failed` with the node's reason or `expired`. Without `validUntil` the SDK reads it from
`/v1/transactions/{id}`, and an id the server does not know throws its 404; with `validUntil` such an
id is waited for too, since it may not have reached this server yet. With `wireHex`, the signed transaction,
a wait also sends it again, at most every 30 s, while the node does not know it.

## Address verification and ownership

```js
import { addressVerificationWords, createAddressProofRequest, verifyAddressProof } from "@tenrai/sdk";

addressVerificationWords(address);              // ["windmill", "talc", "frosty", "fjord", "frothy", "sorghum"]
const request = createAddressProofRequest(address, { validFor: 600 });
const proof = await wallet.proveAddress(request); // on the owner's side
verifyAddressProof(proof, { request });         // { result: "valid", valid: true, … }
```

| Function | |
| --- | --- |
| `addressVerificationWords(address)` | Six public words for an address of any network; they are not a recovery phrase |
| `createAddressProofRequest(address, { validFor?, now? })` | A request with a random 32-byte challenge, answerable for `validFor` seconds (600, at most one year) |
| `readAddressProofRequest(request)` | Reads a request from JSON text or an object and refuses malformed ones and multisig addresses; show its address and expiry before `proveAddress` |
| `verifyAddressProof(proof, { request?, now? })` | `result`: `valid`, `malformed`, `wrong-request`, `not-single-key`, `key-mismatch`, `expired` or `bad-signature`, plus `reason`, address, network, `verificationWords`, challenge and `expiresAt` |
| `ADDRESS_WORD_LIST` | The 2048 words of version 1 |

Requests and proofs are the JSON documents of the command-line wallet and the web wallets; pass them
as objects or as JSON text. Without `request`, compare the challenge yourself. Verification runs in
TypeScript and needs no WASM.

## Signed answers

A node signs every answer to a request that carries a nonce, with ML-DSA-65; the Tenrai API does when
its operator turns signing on, and only then serves `/v1/node/identity`. Pin the identity the operator
publishes: every successful REST answer and every signed error is checked, and a missing or wrong
signature throws `TenraiSignatureError`. Refusals from a proxy or a rate limit carry no signature and
arrive as `TenraiApiError`.

```js
import { signedResponses } from "@tenrai/sdk/verify";

const tenrai = new TenraiClient({ verify: signedResponses({ identity: "c97d68ce…", chainId: "…" }) });
```

The public key comes from `/v1/node/identity` and must hash to the pinned identity. Socket frames
are not signed.

## Amounts

Amounts are atoms in decimal strings; one TRAI is 100000000 atoms. The helpers never use floating point.

| Function | |
| --- | --- |
| `parseAtoms("1200005000")` | `1200005000n` |
| `formatTrai("1200005000")` | `"12.00005"`; `{ fixed: true }` gives `"12.00005000"` |
| `parseTrai("12.00005")` | `1200005000n` |
| `toAtomAmount(1200005000n)` | `"1200005000"` |

## Errors and rate limits

| Class | |
| --- | --- |
| `TenraiApiError` | The server refused: `status`, `code`, `retryAfterMillis`, `retryable`, and `reason` on a refused transaction |
| `TenraiNetworkError` | No answer |
| `TenraiTimeoutError` | No answer within `timeoutMillis` |
| `TenraiResponseError` | The answer is not what the API defines |
| `TenraiSignatureError` | A signature is missing or does not verify |
| `TenraiWalletError` | The wallet cannot build the transfer; see `code` |

All extend `TenraiError`. Invalid arguments throw `TypeError` or `RangeError` before any request.

A transaction refused with `409` names its `reason`: `already_pooled` (the node holds this very
transaction), `input_pooled` (another pooled transaction spends one of its inputs) or `input_missing`
(an input is not in the finalized UTXO set). A reason this SDK does not know reads as `undefined`.

The Tenrai API counts every refused request against the client and blocks it for a while after too
many, so `target: "api"` stays below its limits. A `429` holds back all reads of the client, for any
target: nothing is sent for the server's `retry_after_millis`, longer after each further refusal, and
then one request at a time until the refusals stop for 10 s. A read refused with `429` or `503` is repeated after
the server's `retry_after_millis`, a read that got no answer after a short backoff, both up to
`retries` times. A submission is repeated only after `429` or `503`, never after a lost answer or a
proxy error such as `504`. What is left reaches the caller as `TenraiApiError` with `retryable` and
`retryAfterMillis`. Sockets reconnect on their own with growing, jittered delays.

## Runtimes

| Runtime | |
| --- | --- |
| Node.js 22.12+ | `import`, and `require` through Node's ESM support |
| Browsers | With a bundler, or an import map for the two `@noble` packages |
| Older Node.js | Pass `fetch` and `WebSocket` (from the `ws` package) in the options |

## Examples

| File | |
| --- | --- |
| `examples/balance.mjs <address> [url]` | Balance of one address |
| `examples/send.mjs <to> <amount> [url]` | Send from the wallet in `TENRAI_MNEMONIC` and wait until final |
| `examples/watch-transaction.mjs <id> [url]` | Status updates until final |
| `examples/follow-cuts.ts [url]` | Finalized cuts, resumed after a restart |
| `examples/watch-address.mjs <address> [url]` | Balance and pending payments |
| `examples/node-info.mjs [url]` | Network, head, supply and hash rate |
| `examples/submit.ts <wire hex> [url]` | Submit a transaction signed elsewhere |
| `examples/verified.mjs <identity> [url]` | Signed head |

```
npm run build
node examples/balance.mjs trai1… http://127.0.0.1:28701
```

## Development

| Command | |
| --- | --- |
| `npm test` | Unit tests, a local WebSocket server and the wallet against recorded node documents, then `test:synthetic` |
| `npm run test:synthetic` | The wallet on fake nodes (`test/*.synthetic.ts`); see below |
| `npm run check` | Type check, examples included |
| `npm run build` | `dist/` with JavaScript and type declarations |
| `npm run docs` | Regenerates `docs/api` |

A wallet proves each input it signs with a certified UTXO presence proof. The tests that need genuine proofs replay a
native production run: generate it with `e2e-production.mjs --mode native --capture` from the test repository and set
the absolute path of its `synthetic-native-public-vectors.json` in `TENRAI_NATIVE_CAPTURE`. Without it those tests
fail. Fake nodes cannot certify anything, so the `*.synthetic.ts` tests load `test/support/synthetic-chain.ts`, which
gives the wallet an input check against the fake node's own UTXO pages; the SDK itself has no such switch.

## Native locks

Protocol 2 supports versioned timelocks, SHA-256 hashlocks and HTLC claim/refund
branches. `NativeLockSession` from `@tenrai/sdk/wallet` creates, imports and watches
public descriptors, verifies finalized UTXO proofs, and prepares an immutable
spend review. `wallet.prepareNativeLockSpend` uses the ordinary wallet's input
reservation and retry handling. Read [the native lock integration guide](NATIVE-LOCKS.md)
for creation, funding, recovery backups and redemption.

Private note balances and counts cover the complete verified local inventory.
The refresh result contains at most 128 notes. Continue with the page method,
passing nextNote as its after option, while nextNote is non-null.
Each row includes its canonical noteCommitment. Payment arrival tracking uses
these commitments and the certified global cursor.

A private store provides a stable id for its account-session lease and durably
commits state, mark and sends before resolving write. Browser sessions use
account-scoped IndexedDB ciphertext pages. Other applications supply localPages
and inventoryPages; sqlitePrivateLocalScanStore and sqlitePrivateInventoryStore
wrap dedicated disk SQLite connections. Recovery checkpoints and live inventory
contain encrypted data. Interrupted scans resume acknowledged pages. Scratch
pages may be replaced during replay; inventory objects are immutable by content ID.
