# Native locks

Protocol 2 supports timelocks, SHA-256 hashlocks and HTLCs. `NativeLockSession` creates and validates public descriptors using the protocol WASM. Heights are canonical decimal strings and refer to finalized cuts.

## Create and fund

```ts
import { NativeLockSession } from "@tenrai/sdk/wallet";

const locks = await NativeLockSession.fromManifest(await client.transactions.manifest());
const descriptor = locks.create({
  type: "htlc",
  claim_address: wallet.address(),
  refund_address: refundAddress,
  hash_hex: locks.hash(preimageHex),
  refund_height: refundHeight,
});
```

Use a fresh cryptographically random 32-byte secret for each HTLC. A standalone hashlock accepts a 1–64 byte preimage. Timelocks take `owner_address` and `unlock_height`. Hashlocks take `owner_address` and `hash_hex`.

Back up `descriptor.descriptor_hex` before funding `descriptor.address` through the usual wallet review and submission flow. Store the preimage separately. For each key you own, retain its account, branch and index with the recovery phrase and any passphrase.

## Redeem

`locks.inspect(descriptorHex)` validates a descriptor and `locks.watch(client, descriptorHex)` lists its outputs at a fixed finalized snapshot. Use the intended outpoint for a spend.

```ts
const review = await wallet.reviewNativeLockSpend(locks, client, {
  descriptorHex,
  branch: "claim",
  preimageHex,
  outpoint,
  destination: wallet.address(),
  maxFee: maxFeeAtoms,
});
```

Show the authority, branch, outpoint, destination, amount, fee and validity interval for review. After confirmation, call `wallet.prepareNativeLockSpend(locks, review, keyIndex, keyBranch)` and submit its result with `wallet.submit`. The wallet checks finalized membership before signing and journals the original before submission.

An HTLC claim must execute before `refund_height`. Refunds open at that height and timelock claims at `unlock_height`. Omit the preimage for a refund or timelock claim. Use a current finalized view and allow time for execution before the refund boundary. Sharing a signed claim exposes its preimage, even before execution.

If a reply is lost, check the transaction ID and retry the retained wire. Keep the original reserved until verified reconciliation.
