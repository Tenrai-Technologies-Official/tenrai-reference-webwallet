import type { StakePositionState, StakePositionView, StakingEstimate, ValidatorList, ValidatorUptimeList, ValidatorView } from "@tenrai/sdk";
import type { PreparedTransfer } from "@tenrai/sdk/wallet";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Confirm } from "../components/confirm.tsx";
import { Facts } from "../components/facts.tsx";
import { AUTO_FEE, Field, FeeField, type FeeChoice, atomsOf, feeOptions, feeText } from "../components/fields.tsx";
import { useToast } from "../components/toast.tsx";
import { Amount, Badge, Countdown } from "../components/values.tsx";
import { dateTime, duration, plural, shortAddress, shortId, trai } from "../format.ts";
import { problem } from "../problem.ts";
import { readyToSend } from "../sync.ts";
import { tenrai } from "../tenrai.ts";
import { useSession } from "./session.tsx";
import { type Uptime, Validators, ago, commissionText, health, percent, ranked, uptimeOf, validatorStatus } from "./Validators.tsx";

const STATES: Record<StakePositionState, [string, "good" | "wait" | undefined]> = {
  bonded: ["Staked", "good"],
  exit_requested: ["Unbond requested", "wait"],
  unbonding: ["Unbonding", "wait"],
  withdrawable: ["Ready to withdraw", undefined],
};

const VALIDATOR_REFRESH_MILLIS = 15_000;

function validatorExit(validator: ValidatorView): string {
  return validator.exit_request_height === null
    ? "No exit requested"
    : `Exit requested at cut ${validator.exit_request_height}`;
}

function endpointText(validator: ValidatorView): string {
  const endpoint = validator.overlay_endpoint_hex;
  const shown = endpoint.length > 24 ? `${endpoint.slice(0, 12)}\u2026${endpoint.slice(-12)}` : endpoint;
  const pending = validator.pending_endpoint;
  return pending ? `${shown}, replacement from epoch ${pending.activate_after_epoch}, cut ${pending.activate_after_height}` : shown;
}

function validatorFacts(validator: ValidatorView, up: Uptime | null): [string, ReactNode][] {
  const signed: [string, ReactNode][] = up?.inCommittee
    ? [
        ["Signed", percent(up.share)],
        ["Last signature", ago(up.lastAgoMillis)],
      ]
    : up
      ? [["Signed", "Not in the current committee"]]
      : [];
  return [
    ["Health", health(validator, up).label],
    ...signed,
    ["Status", validatorStatus(validator)],
    ["Validator exit", validatorExit(validator)],
    ["Commission", commissionText(validator)],
    ["Overlay endpoint", <span className="mono">{endpointText(validator)}</span>],
    ["Delegations", validator.accepting_delegations ? "Accepted" : "Closed"],
    [
      "Open positions",
      `${plural(validator.available_position_slots, "slot")} of ${plural(validator.position_capacity, "position")}`,
    ],
    ["Last heartbeat", `Epoch ${validator.last_heartbeat_epoch}`],
    [
      "Last certified attendance",
      validator.last_attendance_epoch === null ? "Not recorded yet" : `Epoch ${validator.last_attendance_epoch}`,
    ],
    [
      "Jail status",
      validator.jailed_until_epoch === null ? "Not jailed" : `Jail ends before epoch ${validator.jailed_until_epoch}`,
    ],
    [
      "Pending key rotation",
      validator.pending_key_activation_epoch === null ? "None" : `Activates in epoch ${validator.pending_key_activation_epoch}`,
    ],
  ];
}

interface Question {
  title: string;
  facts: [string, ReactNode][];
  note?: string;
  action: string;
  run: () => Promise<void>;
  /** Amount used to apply the transaction password policy. */
  moves: bigint;
}

export function Staking() {
  const { wallet, data, track, salvage, asks } = useSession();
  const notify = useToast();
  const [validatorList, setValidatorList] = useState<ValidatorList>();
  const [uptime, setUptime] = useState<ValidatorUptimeList>();
  const [minimum, setMinimum] = useState<bigint>();
  const [validatorId, setValidatorId] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState<FeeChoice>(AUTO_FEE);
  const [estimate, setEstimate] = useState<StakingEstimate>();
  const [question, setQuestion] = useState<Question>();
  const [error, setError] = useState<string>();
  const [validatorError, setValidatorError] = useState<string>();

  useEffect(() => {
    let open = true;
    let reading = false;
    const read = async () => {
      if (reading) {
        return;
      }
      reading = true;
      try {
        const [list, signed] = await Promise.all([tenrai.staking.validators({ limit: 256 }), tenrai.staking.uptime().catch(() => undefined)]);
        if (!open) {
          return;
        }
        setUptime(signed);
        setMinimum(BigInt(list.minimum_delegation));
        setValidatorList(list);
        setValidatorError(undefined);
        // Keep the selected validator while it accepts stake.
        setValidatorId((chosen) => (list.validators.some((validator) => validator.validator_id === chosen && validator.accepting_delegations) ? chosen : ""));
      } catch (failure) {
        if (open) {
          setValidatorError(problem(failure));
        }
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), VALIDATOR_REFRESH_MILLIS);
    return () => {
      open = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let atoms: bigint;
    try {
      atoms = atomsOf(amount);
    } catch {
      setEstimate(undefined);
      return;
    }
    const timer = setTimeout(() => {
      tenrai.economics.stakingEstimate(atoms).then(setEstimate, () => setEstimate(undefined));
    }, 400);
    return () => clearTimeout(timer);
  }, [amount]);

  const positions = data?.positions ?? [];
  const validators = validatorList?.validators ?? [];
  const selectedValidator = validators.find((validator) => validator.validator_id === validatorId);
  const choices = ranked(
    validators.filter((validator) => validator.accepting_delegations),
    uptime,
  );
  const inState = (...states: StakePositionState[]) => positions.filter((position) => states.includes(position.state));
  const sum = (...states: StakePositionState[]) => inState(...states).reduce((total, position) => total + BigInt(position.principal), 0n);

  const review = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      if (!validatorId) {
        throw new Error("choose a validator");
      }
      if (!selectedValidator?.accepting_delegations) {
        throw new Error("this validator is not accepting new delegations");
      }
      const atoms = atomsOf(amount);
      if (minimum !== undefined && atoms < minimum) {
        throw new Error(`the minimum stake is ${trai(minimum)}`);
      }
      const options = feeOptions(fee);
      const period = await tenrai.address.unbonding(wallet.address(0), { limit: 1 }).catch(() => undefined);
      setQuestion({
        title: "Stake TRAI",
        facts: [
          ["Validator", <span className="mono">{shortId(validatorId)}</span>],
          ...(selectedValidator
            ? ([
                ["Commission", commissionText(selectedValidator)],
                [
                  "Slots",
                  `${plural(selectedValidator.available_position_slots, "free slot")} of ${plural(selectedValidator.position_capacity, "position")}`,
                ],
              ] as [string, ReactNode][])
            : []),
          ["Amount", <Amount atoms={atoms} />],
          ["Rewards to", <span className="mono">{shortAddress(wallet.address(0))}</span>],
          ...(period
            ? ([["Unbonding takes", `${plural(period.unbonding_delay_cuts, "cut")}, about ${duration(period.estimated_unbonding_millis)}`]] as [string, ReactNode][])
            : []),
          ["Fee", feeText(fee)],
        ],
        note: period
          ? `The stake leaves the balance while it is bonded. After an unbond it can be withdrawn once about ${duration(period.estimated_unbonding_millis)} have passed.`
          : "The stake leaves the balance while it is bonded. After an unbond it can be withdrawn once the unbonding period is over.",
        action: "Stake",
        moves: atoms,
        run: async () => {
          const change = (transfer: PreparedTransfer) => -(transfer.amount + transfer.fee);
          try {
            await readyToSend(notify);
            track("Stake", [await wallet.bond(tenrai, { validatorId, amount: atoms, ...options })], change);
            notify("Stake sent. It counts once a cut executes it.");
          } catch (failure) {
            if (!salvage("Stake", failure, change)) {
              throw failure;
            }
            notify(problem(failure));
          }
          setAmount("");
        },
      });
    } catch (failure) {
      setError(problem(failure));
    }
  };

  const unbond = async (position: StakePositionView) => {
    const period = await tenrai.address.unbonding(position.owner_address, { limit: 1 }).catch(() => undefined);
    const wait: [string, ReactNode][] = period
      ? [
          [
            "Unbonding takes",
            `${plural(period.unbonding_delay_cuts, "cut")}, about ${duration(period.estimated_unbonding_millis)}, until about ${dateTime(Date.now() + period.estimated_unbonding_millis)}`,
          ],
        ]
      : [];
    setQuestion({
      title: "Unbond",
      facts: [
        ["Position", <span className="mono">{shortId(position.position_id)}</span>],
        ["Amount", <Amount atoms={position.principal} />],
        ...wait,
        ["Fee", "Automatic, normal"],
      ],
      note: "The stake stops earning now and can be withdrawn once the unbonding period is over.",
      action: "Unbond",
      moves: BigInt(position.principal),
      run: async () => {
        const change = (transfer: PreparedTransfer) => -transfer.fee;
        try {
          await readyToSend(notify);
          track("Unstake", [await wallet.unbond(tenrai, { positionId: position.position_id })], change);
          notify("Unbonding started.");
        } catch (failure) {
          if (!salvage("Unstake", failure, change)) {
            throw failure;
          }
          notify(problem(failure));
        }
      },
    });
  };

  const withdraw = (position: StakePositionView) =>
    setQuestion({
      title: "Withdraw",
      facts: [
        ["Position", <span className="mono">{shortId(position.position_id)}</span>],
        ["Returns", <Amount atoms={position.principal} />],
        ["Fee", "Automatic, normal"],
      ],
      action: "Withdraw",
      moves: BigInt(position.principal),
      run: async () => {
        const change = (transfer: PreparedTransfer) => transfer.amount - transfer.fee;
        try {
          await readyToSend(notify);
          track("Withdraw", [await wallet.withdraw(tenrai, { positionId: position.position_id })], change);
          notify("Withdrawal sent.");
        } catch (failure) {
          if (!salvage("Withdraw", failure, change)) {
            throw failure;
          }
          notify(problem(failure));
        }
      },
    });

  return (
    <div className="staking">
      <div className="summary">
        <article className="tile">
          <p className="stat__k">Staked</p>
          <p className="stat__v">{trai(sum("bonded"))}</p>
          <p className="stat__s">{plural(inState("bonded").length, "position")}</p>
        </article>
        <article className="tile">
          <p className="stat__k">Unbonding</p>
          <p className="stat__v">{trai(sum("exit_requested", "unbonding"))}</p>
          <p className="stat__s">{trai(sum("withdrawable"))} ready to withdraw</p>
        </article>
      </div>

      <article className="card stake-card">
        <h2 className="block__title">Stake</h2>
        {validatorList && (
          <p className="note">
            {plural(validatorList.available_validator_slots, "validator slot")} and {plural(validatorList.available_position_slots, "stake position")} are available network-wide.
          </p>
        )}
        <form className="stack-form" onSubmit={review} noValidate>
          <Field label="Validator">
            <select value={validatorId} onChange={(event) => setValidatorId(event.target.value)} disabled={choices.length === 0}>
              <option value="">{choices.length ? "Choose a validator" : "No validator takes stake right now"}</option>
              {choices.map(({ validator, health: state }) => (
                <option key={validator.validator_id} value={validator.validator_id}>
                  {`${shortId(validator.validator_id)} · ${state.label} · ${(validator.commission_bps / 100).toFixed(1)}% commission`}
                </option>
              ))}
            </select>
          </Field>
          {selectedValidator && (
            <div className="stack-form" aria-live="polite">
              <p className="note">
                {commissionText(selectedValidator)}. {plural(selectedValidator.available_position_slots, "free slot")} of {plural(selectedValidator.position_capacity, "position")} remain.
              </p>
              <Facts rows={validatorFacts(selectedValidator, uptimeOf(uptime, selectedValidator.validator_id))} />
            </div>
          )}
          <Field
            label="Amount (TRAI)"
            hint={
              <span className="note">
                {minimum !== undefined && `At least ${trai(minimum)}. `}
                {estimate &&
                  `Before validator commission: about ${trai(estimate.expected_reward_per_day)} a day, ${estimate.annual_percentage_rate.toFixed(2)} % a year at today's stake.`}
              </span>
            }
          >
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" autoComplete="off" maxLength={40} placeholder="0.00000000" />
          </Field>
          <FeeField value={fee} onChange={setFee} />
          {validatorError && (
            <p className="form-error" role="alert">
              {validatorError}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn--solid" type="submit" disabled={!data || !selectedValidator?.accepting_delegations}>
            Review stake
          </button>
        </form>
      </article>

      <section className="block positions" aria-labelledby="positions-title">
        <h2 id="positions-title" className="block__title">
          Your positions
        </h2>
        {positions.length === 0 ? (
          <p className="empty">{data ? "Nothing staked yet." : "Reading the positions…"}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Validator</th>
                <th>Amount</th>
                <th>State</th>
                <th>Reward snapshot</th>
                <th>Withdrawable</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => {
                const [label, tone] = STATES[position.state];
                return (
                  <tr key={position.position_id}>
                    <td data-label="Validator" className="mono">
                      {shortId(position.validator_id)}
                    </td>
                    <td data-label="Amount">
                      <Amount atoms={position.principal} />
                    </td>
                    <td data-label="State">
                      <Badge tone={tone}>{label}</Badge>
                    </td>
                    <td data-label="Reward snapshot">
                      <Badge tone={position.future_rewards_eligible ? "good" : "wait"}>{position.future_rewards_eligible ? "Included" : "Excluded"}</Badge>
                    </td>
                    <td data-label="Withdrawable">
                      <Availability position={position} loadedAt={data?.loadedAt ?? Date.now()} />
                    </td>
                    <td data-label="">
                      {position.state === "bonded" && (
                        <button type="button" className="btn btn--ghost btn--small" onClick={() => unbond(position)}>
                          Unbond
                        </button>
                      )}
                      {position.state === "withdrawable" && (
                        <button type="button" className="btn btn--solid btn--small" onClick={() => withdraw(position)}>
                          Withdraw
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <Validators
        validators={validators}
        uptime={uptime}
        selected={validatorId}
        onChoose={(id) => {
          setValidatorId(id);
          document.querySelector(".stake-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />

      {question && (
        <Confirm
          title={question.title}
          facts={question.facts}
          note={question.note}
          action={question.action}
          password={asks(question.moves)}
          onConfirm={question.run}
          onClose={() => setQuestion(undefined)}
        />
      )}
    </div>
  );
}

// Keep the first estimate for each state to avoid resetting the countdown.
const withdrawAt = new Map<string, { key: string; at: number }>();

function settledTime(position: StakePositionView, loadedAt: number): number | null {
  const key = `${position.state}:${position.exit_request_height ?? ""}:${position.withdrawable_after_height ?? ""}`;
  const known = withdrawAt.get(position.position_id);
  if (known?.key === key) {
    return known.at;
  }
  const time = position.estimated_millis_until_withdrawable;
  if (time === null) {
    return null;
  }
  withdrawAt.set(position.position_id, { key, at: loadedAt + time });
  return loadedAt + time;
}

function Availability({ position, loadedAt }: { position: StakePositionView; loadedAt: number }) {
  if (position.state === "withdrawable") {
    return "now";
  }
  if (position.cuts_until_withdrawable === null) {
    return "after unbonding";
  }
  const at = settledTime(position, loadedAt);
  return (
    <span className="availability">
      {at !== null && <Countdown until={at} />}
      <span className="note">{`${plural(position.cuts_until_withdrawable, "cut")} left${at === null ? "" : `, until about ${dateTime(at)}`}`}</span>
    </span>
  );
}
