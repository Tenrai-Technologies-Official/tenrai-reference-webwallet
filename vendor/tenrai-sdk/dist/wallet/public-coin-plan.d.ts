import { type Plan, type PlanRequest } from "./plan.ts";
import type { ProtocolRules } from "./protocol.ts";
import type { CoinSource } from "./public-coin-source.ts";
export declare function planFromSource(protocol: ProtocolRules, request: PlanRequest, source: CoinSource): Promise<Plan>;
