# Tenrai SDK

TypeScript SDK for Tenrai REST and WebSocket APIs, signed response verification, and wallet operations backed by protocol WebAssembly.

## Install

Use Node.js 22.12 or later in consumers and Node.js 22.18 or later for development. Bundle the SDK for browser use.

Build the npm package from this checkout.

```sh
npm ci
npm pack
```

Copy the resulting `tenrai-sdk-0.1.1.tgz` to your application and install it there.

```sh
npm install ./tenrai-sdk-0.1.1.tgz
```

## Read the chain

```js
import { TenraiClient } from "@tenrai/sdk";

const client = new TenraiClient({
  url: "http://127.0.0.1:28701",
  target: "node",
});

const { network, finalized } = await client.node.info();
console.log(network, finalized.height);
```

`new TenraiClient()` connects to the public Tenrai API. Use `target: "api"` for a gateway. REST calls accept an abort signal. `client.events({ afterHeight })` follows finalized cuts and resumes by height after a reconnect. Close the stream when finished.

API amounts are decimal strings in atoms. Use `parseTrai` and `formatTrai` to convert between TRAI text and integer atoms.

Use `signedResponses` from `@tenrai/sdk/verify` with an identity obtained from the operator through a trusted channel. This authenticates the API response. Verify finalized state separately before using proof results to authorize spending.

## Wallet integration

`@tenrai/sdk/wallet` supports public transfers, staking, multisig, native locks and private notes. The protocol WASM derives keys and signs transactions. Back up the recovery phrase and any passphrase, and close the wallet after use.

Configure a durable finality guard and the account stores before enabling spending. Managed public submission and `exportSigned` require a public transfer journal and outcome archive. Store adapters must acknowledge writes after durable commit. Retain the journals when backing up the wallet.

`prepare` returns a review. Confirm the recipient, amount and fee before `submit`. If submission is ambiguous, keep the original transaction and input reservations. Use `retryPublic` for the retained bytes and `reconcilePublic` for verified settlement. Keep unresolved results available through `unknownPublicOutcomes`.

Private notes use a durable account store and a prover. Check `privateTransfersUsable(await client.privateTransfers.status())` before enabling private spending. The browser prover uses the packaged worker and WASM assets.

See the [Reference Web Wallet](https://github.com/Tenrai-Technologies-Official/tenrai-reference-webwallet) for browser storage and the [native lock guide](NATIVE-LOCKS.md) for conditional spends.

## Development

```sh
npm run check
npm test
npm run docs
```

`npm run docs` generates the API reference in `docs/api/`. Runnable client examples live in `examples/`.

For tests that replay certified cuts, generate a capture with `browser-wallet/e2e-production.mjs --mode native --capture` from the Tenrai test tools. Set `TENRAI_NATIVE_CAPTURE` to the absolute path of `synthetic-native-public-vectors.json`.

See [WASM release artifacts](wasm/README.md) for the protocol build and pins.

## License

Apache-2.0.
