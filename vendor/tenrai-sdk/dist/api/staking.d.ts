import type { CallOptions, Transport } from "../http.ts";
import { type StakePositionDetail, type StakePositionList, type ValidatorDetail, type ValidatorList, type ValidatorPositionList, type ValidatorSlashStatus, type ValidatorUptimeList } from "../types/staking.ts";
import { type PageOptions } from "./address.ts";
export declare class StakingApi {
    #private;
    /** @internal */
    constructor(http: Transport);
    /** `GET /v1/staking/validators`: registered validators and the total bonded stake, paged. */
    validators(options?: PageOptions): Promise<ValidatorList>;
    /** `GET /v1/staking/uptime`: cuts each validator signed over the last 10,000. */
    uptime(options?: CallOptions): Promise<ValidatorUptimeList>;
    /** `GET /v1/staking/validators/{id}`: one validator with its self-bond. */
    validator(validatorId: string, options?: CallOptions): Promise<ValidatorDetail>;
    /** `GET /v1/staking/validators/{id}/slash`: active, retained slash data for one validator. */
    validatorSlash(validatorId: string, options?: CallOptions): Promise<ValidatorSlashStatus>;
    /** `GET /v1/staking/validators/{id}/positions`: the validator's stake positions, paged, with its totals. */
    validatorPositions(validatorId: string, options?: PageOptions): Promise<ValidatorPositionList>;
    /** `POST /v1/staking/positions`: stake positions owned by up to 64 addresses, paged. */
    positions(owners: readonly string[], options?: PageOptions): Promise<StakePositionList>;
    /** `GET /v1/staking/positions/{id}`: one stake position. */
    position(positionId: string, options?: CallOptions): Promise<StakePositionDetail>;
}
