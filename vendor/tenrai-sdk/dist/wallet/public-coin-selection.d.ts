import { type Coin, type InputFees } from "./plan.ts";
import { type CoinSource } from "./public-coin-source.ts";
export declare function selectFromSource(source: CoinSource, target: bigint, limit: number, known: ReadonlySet<string>): Promise<Coin[]>;
export declare function fillFromSource(source: CoinSource, chosen: Coin[], limit: number, known: ReadonlySet<string>, fees: InputFees): Promise<Coin[]>;
export declare function firstFromSource(source: CoinSource, limit: number): Promise<Coin[]>;
export declare function includedFromSource(source: CoinSource, include: Coin[], need: bigint, limit: number, known: ReadonlySet<string>): Promise<Coin[]>;
