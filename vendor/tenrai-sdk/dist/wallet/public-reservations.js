/** Bounded ownership of public inputs; a stale plan never overwrites or releases another artifact. */
import { TenraiWalletError } from "../errors.js";
const MAX_KEYS = 1024, MAX_UNTIL = (1n << 64n) - 1n;
const ID = /^[0-9a-f]{96}$/, POINT = /^[0-9a-f]{96}:(0|[1-9][0-9]{0,9})$/;
function fail(message) { throw new TenraiWalletError(message, "rejected"); }
function owner(value) { if (typeof value !== "symbol" && (typeof value !== "string" || !ID.test(value)))
    fail("Invalid public reservation owner."); }
function keys(values) {
    if (!Array.isArray(values) || values.length > MAX_KEYS || new Set(values).size !== values.length)
        fail("Public input reservations repeat or exceed the bounded input limit.");
    for (const value of values)
        if (typeof value !== "string" || !POINT.test(value) || BigInt(value.slice(97)) > 0xffffffffn)
            fail("Invalid public reservation outpoint.");
}
function until(value) { if (typeof value !== "bigint" || value < 0n || value > MAX_UNTIL)
    fail("Invalid public reservation expiry."); }
export class PublicReservations {
    #deadlines = new Map();
    #owners = new Map();
    privatelyHeld;
    constructor(privatelyHeld) { this.privatelyHeld = privatelyHeld; }
    get deadlines() { return this.#deadlines; }
    assertAvailable(points) {
        keys(points);
        for (const point of points)
            if (this.#owners.has(point) || this.#deadlines.has(point) || this.privatelyHeld(point))
                fail("Another retained public or private artifact holds a selected input.");
        if (this.#owners.size + points.length > MAX_KEYS)
            fail("Too many reserved public inputs; reconcile outstanding transfers first.");
    }
    temporary(points, validUntil) {
        this.assertAvailable(points);
        until(validUntil);
        const claim = Symbol("public-compound");
        for (const point of points) {
            this.#owners.set(point, claim);
            this.#deadlines.set(point, validUntil);
        }
        return claim;
    }
    claimOwned(artifact, points, validUntil) {
        this.retainMany([{ owner: artifact, keys: points, validUntil }]);
    }
    /** Complete preflight precedes every mutation, including recovery of a whole retained journal. */
    retainMany(claims) {
        if (!Array.isArray(claims) || claims.length > MAX_KEYS)
            fail("Too many retained public transfer claims.");
        const planned = new Map();
        for (const claim of claims) {
            owner(claim.owner);
            keys(claim.keys);
            until(claim.validUntil);
            for (const point of claim.keys) {
                const duplicate = planned.get(point), existing = this.#owners.get(point);
                if (duplicate || this.privatelyHeld(point) || this.#deadlines.has(point) !== this.#owners.has(point)
                    || existing !== undefined && (existing !== claim.owner || this.#deadlines.get(point) !== claim.validUntil))
                    fail("A retained public input has another owner or conflicting immutable expiry.");
                planned.set(point, { owner: claim.owner, validUntil: claim.validUntil });
            }
        }
        const additional = [...planned.keys()].reduce((count, point) => count + Number(!this.#owners.has(point)), 0);
        if (this.#owners.size + additional > MAX_KEYS)
            fail("Too many reserved public inputs; reconcile outstanding transfers first.");
        for (const [point, claim] of planned) {
            this.#owners.set(point, claim.owner);
            this.#deadlines.set(point, claim.validUntil);
        }
    }
    assertOwned(artifact, points) {
        owner(artifact);
        keys(points);
        for (const point of points)
            if (this.#owners.get(point) !== artifact || !this.#deadlines.has(point) || this.privatelyHeld(point))
                fail("The public input reservation changed its artifact owner.");
    }
    transfer(claim, artifact, points, validUntil) {
        owner(artifact);
        until(validUntil);
        this.assertOwned(claim, points);
        for (const point of points)
            if (this.#deadlines.get(point) !== validUntil)
                fail("The public input reservation changed its immutable expiry.");
        for (const point of points)
            this.#owners.set(point, artifact);
    }
    /** Only authenticated terminal reconciliation or the exact unsent batch owner may free a hold. */
    releaseOwned(artifact, points) {
        owner(artifact);
        keys(points);
        for (const point of points)
            if (this.#owners.get(point) === artifact) {
                this.#owners.delete(point);
                this.#deadlines.delete(point);
            }
    }
}
