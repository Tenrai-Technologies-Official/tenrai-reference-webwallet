const HASH384 = /^[0-9a-f]{96}$/;
const HEX = /^(?:[0-9a-f]{2})+$/;
const ADDRESS = /^[a-z0-9]{8,128}$/;
const CURSOR = /^[A-Za-z0-9._~-]{1,1024}$/;
export const U16 = 65_535;
export const U32 = 4_294_967_295;
export function hash384(value, name = "id") {
    if (typeof value !== "string" || !HASH384.test(value)) {
        throw new TypeError(`${name} must be 96 lowercase hex characters`);
    }
    return value;
}
export function hex(value, name) {
    if (typeof value !== "string" || !HEX.test(value)) {
        throw new TypeError(`${name} must be lowercase hex with an even length`);
    }
    return value;
}
export function address(value) {
    if (typeof value !== "string" || !ADDRESS.test(value)) {
        throw new TypeError(`not a Tenrai address: ${JSON.stringify(value)}`);
    }
    return value;
}
export function addresses(values, most) {
    if (!Array.isArray(values) || values.length === 0 || values.length > most) {
        throw new RangeError(`pass 1 to ${most} addresses`);
    }
    return values.map(address);
}
export function whole(value, name, most = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < 0 || value > most) {
        throw new RangeError(`${name} must be a whole number from 0 to ${most}`);
    }
    return value;
}
export function limit(value, most) {
    if (value === undefined) {
        return undefined;
    }
    if (!Number.isSafeInteger(value) || value < 1 || value > most) {
        throw new RangeError(`limit must be from 1 to ${most}`);
    }
    return value;
}
export function cursor(value) {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "string" || !CURSOR.test(value)) {
        throw new TypeError("cursor must be the value a previous page returned");
    }
    return value;
}
