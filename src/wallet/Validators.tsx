import type { ValidatorInactiveReason, ValidatorUptimeList, ValidatorView } from "@tenrai/sdk";
import { Hint } from "../components/hint.tsx";
import { Badge } from "../components/values.tsx";
import { count, duration, plural, shortId } from "../format.ts";

// A validator that signed one of these last cuts is online.
const ONLINE_CUTS = 10;
const HEALTHY_SHARE = 0.95;
const ORDER: Record<Health["key"], number> = { healthy: 0, penalized: 1, degraded: 2, standby: 3, leaving: 4, offline: 5 };

export interface Uptime {
  inCommittee: boolean;
  share: number;
  signed: number;
  committee: number;
  online: boolean;
  lastAgoMillis: number | null;
  sinceMillis: number | null;
}

interface Health {
  key: "healthy" | "penalized" | "degraded" | "standby" | "leaving" | "offline";
  label: string;
  tone: "good" | "wait" | "bad";
}

const INACTIVE_REASON: Record<ValidatorInactiveReason, string> = {
  exit_requested: "exit requested",
  activation_pending: "activation pending",
  heartbeat_expired: "heartbeat overdue",
  jailed: "jailed",
};

export function commissionText(validator: ValidatorView): string {
  const current = `${(validator.commission_bps / 100).toFixed(1)}% commission`;
  const pending = validator.pending_commission;
  return pending
    ? `${current}, ${(pending.bps / 100).toFixed(1)}% from epoch ${pending.activate_after_epoch}, cut ${pending.activate_after_height}`
    : current;
}

export function validatorStatus(validator: ValidatorView): string {
  if (validator.is_active) {
    return "Active";
  }
  const reasons = validator.inactive_reasons.map((reason) => INACTIVE_REASON[reason]);
  return reasons.length === 0 ? "Inactive" : `Inactive: ${reasons.join(", ")}`;
}

/** Null without uptime data; a missing validator sat in no recent committee. */
export function uptimeOf(list: ValidatorUptimeList | undefined, validatorId: string): Uptime | null {
  if (!list) {
    return null;
  }
  const row = list.validators.find((entry) => entry.validator_id === validatorId);
  if (!row) {
    return { inCommittee: false, share: 0, signed: 0, committee: 0, online: false, lastAgoMillis: null, sinceMillis: null };
  }
  const cutsAgo = (height: number) => list.finalized_height - height;
  return {
    inCommittee: row.committee_cuts > 0,
    share: row.committee_cuts ? row.signed_cuts / row.committee_cuts : 0,
    signed: row.signed_cuts,
    committee: row.committee_cuts,
    online: row.last_signed_height !== null && cutsAgo(row.last_signed_height) <= ONLINE_CUTS,
    lastAgoMillis: row.last_signed_height === null ? null : cutsAgo(row.last_signed_height) * list.target_cut_interval_millis,
    sinceMillis: row.first_signed_height === null ? null : (cutsAgo(row.first_signed_height) + 1) * list.target_cut_interval_millis,
  };
}

export function health(validator: ValidatorView, up: Uptime | null): Health {
  if (validator.state === "exit_requested") {
    return { key: "leaving", label: "Leaving", tone: "wait" };
  }
  if (up && !up.inCommittee) {
    return { key: "standby", label: "Standby", tone: "wait" };
  }
  if (up && !up.online) {
    return { key: "offline", label: "Offline", tone: "bad" };
  }
  if (up && up.share < HEALTHY_SHARE) {
    return { key: "degraded", label: "Degraded", tone: "wait" };
  }
  if (validator.penalty_generation > 0) {
    return { key: "penalized", label: `Penalized ${validator.penalty_generation}x`, tone: "wait" };
  }
  return { key: "healthy", label: "Healthy", tone: "good" };
}

export function percent(share: number): string {
  return `${(share * 100).toFixed(share >= 0.9995 || share === 0 ? 0 : 1)} %`;
}

export function ago(millis: number | null): string {
  if (millis === null) {
    return "never";
  }
  const seconds = Math.round(millis / 1_000);
  if (seconds < 5) {
    return "just now";
  }
  return seconds < 90 ? `${seconds} s ago` : `${duration(millis)} ago`;
}

/** The healthiest first, then by the share of cuts signed. */
export function ranked(validators: ValidatorView[], uptime: ValidatorUptimeList | undefined): { validator: ValidatorView; up: Uptime | null; health: Health }[] {
  return validators
    .map((validator) => {
      const up = uptimeOf(uptime, validator.validator_id);
      return { validator, up, health: health(validator, up) };
    })
    .sort(
      (a, b) =>
        ORDER[a.health.key] - ORDER[b.health.key] ||
        (b.up?.share ?? 0) - (a.up?.share ?? 0) ||
        (a.validator.validator_id < b.validator.validator_id ? -1 : 1),
    );
}

export function Validators({
  validators,
  uptime,
  selected,
  onChoose,
}: {
  validators: ValidatorView[];
  uptime: ValidatorUptimeList | undefined;
  selected: string;
  onChoose: (validatorId: string) => void;
}) {
  const rows = ranked(validators, uptime);
  const note = uptime
    ? `Signed counts the certificates of the last ${count(uptime.cuts)} cuts (about ${duration(uptime.cuts * uptime.target_cut_interval_millis)}) that each validator's committee finalized. A validator that signed one of the last ${ONLINE_CUTS} cuts is online and in sync with consensus.`
    : "This service reports no uptime; health shows only what the chain records.";
  return (
    <section className="block validators" aria-labelledby="validators-title">
      <div className="hint-line">
        <h2 id="validators-title" className="block__title">
          Validators
        </h2>
        <Hint label="About validator health">
          {`${note} Healthy means online, at least 95 % of its recent cuts signed and never penalized. Degraded signs less, offline signed none of the last cuts, standby is eligible but outside the active committee, and leaving takes no new stake.`}
        </Hint>
      </div>
      {rows.length === 0 ? (
        <p className="empty">The service lists no validators.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Validator</th>
              <th>Health</th>
              <th>Status</th>
              <th>Commission</th>
              <th>Signed</th>
              <th>Last signature</th>
              <th>Signing for</th>
              <th>Delegations</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ validator, up, health: state }) => (
              <tr key={validator.validator_id} aria-current={validator.validator_id === selected ? "true" : undefined}>
                <td data-label="Validator" className="mono" title={validator.validator_id}>
                  {shortId(validator.validator_id)}
                </td>
                <td data-label="Health">
                  <Badge tone={state.tone}>{state.label}</Badge>
                </td>
                <td data-label="Status">{validatorStatus(validator)}</td>
                <td data-label="Commission">{commissionText(validator)}</td>
                <td data-label="Signed" title={up?.inCommittee ? `${count(up.signed)} of ${count(up.committee)} committee cuts` : undefined}>
                  {up?.inCommittee ? percent(up.share) : "-"}
                </td>
                <td data-label="Last signature">{up?.inCommittee ? ago(up.lastAgoMillis) : "-"}</td>
                <td data-label="Signing for">{up?.sinceMillis ? duration(up.sinceMillis) : "-"}</td>
                <td data-label="Delegations">
                  {validator.accepting_delegations ? (
                    `${count(validator.available_position_slots)} of ${plural(validator.position_capacity, "slot")} free`
                  ) : (
                    <Badge tone="wait">Not accepting stake</Badge>
                  )}
                </td>
                <td data-label="">
                  {validator.accepting_delegations && (
                    <button type="button" className="btn btn--ghost btn--small" onClick={() => onChoose(validator.validator_id)}>
                      Choose
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
