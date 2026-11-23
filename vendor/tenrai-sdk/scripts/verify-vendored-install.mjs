import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const vendorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const consumerRoot = resolve(vendorRoot, "..", "..");
const installedRoot = resolve(consumerRoot, "node_modules", "@tenrai", "sdk");

function fail(message) { throw new Error(message); }
function canonicalPath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length > 4096 ||
    !/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*$/.test(relativePath) ||
    relativePath.split("/").some((part) => part === "." || part === "..")) {
    fail("package.files must contain literal, canonical relative paths");
  }
  return relativePath;
}

function samePath(left, right) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function rootDirectory(root) {
  const metadata = lstatSync(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !samePath(realpathSync(root), root)) {
    fail("the SDK root contains a symbolic link or directory junction");
  }
}

function entry(root, relativePath) {
  canonicalPath(relativePath);
  let path = root;
  const parts = relativePath.split("/");
  for (const [index, part] of parts.entries()) {
    path = resolve(path, part);
    if (!path.startsWith(root + sep)) fail(`invalid release path ${relativePath}`);
    let metadata;
    try { metadata = lstatSync(path, { bigint: true }); }
    catch (error) { if (error?.code === "ENOENT") fail(`missing ${relativePath}`); throw error; }
    if (metadata.isSymbolicLink()) fail(`symbolic link or directory junction at ${relativePath}`);
    if (!metadata.isDirectory() && !metadata.isFile()) fail(`non-regular release entry ${relativePath}`);
    if (index + 1 < parts.length && !metadata.isDirectory()) fail(`non-directory release parent ${relativePath}`);
    if (!samePath(realpathSync(path), path)) fail(`release path escapes its SDK root: ${relativePath}`);
    if (index + 1 === parts.length) return { path, metadata };
  }
  fail(`invalid release path ${relativePath}`);
}

function file(root, relativePath) {
  const found = entry(root, relativePath);
  if (!found.metadata.isFile()) fail(`missing release file ${relativePath}`);
  return found;
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

/** Hash large assets in bounded chunks. */
function fileHash(root, relativePath) {
  const before = file(root, relativePath);
  if (before.metadata.size > BigInt(Number.MAX_SAFE_INTEGER)) fail(`oversized release file ${relativePath}`);
  const descriptor = openSync(before.path, "r");
  try {
    if (!sameFile(before.metadata, fstatSync(descriptor, { bigint: true }))) fail(`release file changed while opening ${relativePath}`);
    const hash = createHash("sha256"), buffer = Buffer.allocUnsafe(64 * 1024);
    let remaining = Number(before.metadata.size);
    while (remaining > 0) {
      const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, remaining), null);
      if (count === 0) fail(`release file changed while reading ${relativePath}`);
      hash.update(buffer.subarray(0, count)); remaining -= count;
    }
    if (readSync(descriptor, buffer, 0, 1, null) !== 0 ||
      !sameFile(before.metadata, fstatSync(descriptor, { bigint: true })) ||
      !sameFile(before.metadata, file(root, relativePath).metadata)) fail(`release file changed while hashing ${relativePath}`);
    return hash.digest("hex");
  } finally { closeSync(descriptor); }
}

function readJson(root, relativePath) {
  const found = file(root, relativePath);
  if (found.metadata.size > 1024n * 1024n) fail(`oversized JSON ${relativePath}`);
  try { return JSON.parse(readFileSync(found.path, "utf8")); }
  catch { fail(`invalid ${relativePath}`); }
}

/** Walk only package.json and the published file list. */
function releaseInventory(root, packageDocument) {
  const listed = packageDocument?.files;
  if (!Array.isArray(listed) || listed.length === 0 || listed.length > 256) fail("package.files is missing or invalid");
  const roots = ["package.json", ...listed.map(canonicalPath)];
  const files = new Set(), directories = new Set();
  function visit(relativePath, depth = 0) {
    if (depth > 32 || files.size + directories.size >= 100_000) fail("release inventory exceeds its bounded traversal");
    const found = entry(root, relativePath);
    if (found.metadata.isFile()) { files.add(relativePath); return; }
    if (directories.has(relativePath)) return;
    directories.add(relativePath);
    for (const name of readdirSync(found.path).sort()) visit(`${relativePath}/${name}`, depth + 1);
  }
  for (const relativePath of roots) visit(relativePath);
  return [...files].sort();
}

function verify() {
  if (!process.argv[1] || !samePath(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
    fail("the verifier entrypoint contains a symbolic link or directory junction");
  }
  rootDirectory(vendorRoot); rootDirectory(installedRoot);
  const vendorPackage = readJson(vendorRoot, "package.json");
  const installedPackage = readJson(installedRoot, "package.json");
  if (vendorPackage.name !== "@tenrai/sdk" || installedPackage.name !== vendorPackage.name ||
    typeof vendorPackage.version !== "string" || installedPackage.version !== vendorPackage.version) {
    fail("package identity or version differs from the vendored SDK");
  }
  if (fileHash(vendorRoot, "package.json") !== fileHash(installedRoot, "package.json")) fail("package.json differs from the vendored SDK");
  const expected = releaseInventory(vendorRoot, vendorPackage), installed = releaseInventory(installedRoot, installedPackage);
  const expectedSet = new Set(expected), installedSet = new Set(installed);
  const missing = expected.find((path) => !installedSet.has(path));
  if (missing) fail(`missing installed release file ${missing}`);
  const extra = installed.find((path) => !expectedSet.has(path));
  if (extra) fail(`extra installed release file ${extra}`);
  for (const relativePath of expected) {
    if (fileHash(vendorRoot, relativePath) !== fileHash(installedRoot, relativePath)) {
      fail(`${relativePath} differs from the vendored SDK`);
    }
  }

  const release = readJson(vendorRoot, "wasm/release.json");
  const module = release?.assets?.module, wasm = release?.assets?.wasm;
  if (release?.format !== 1 || release?.package !== "tenrai-wasm" || typeof release?.revision !== "string" ||
    module?.file !== "tenrai_wasm.js" || wasm?.file !== "tenrai_wasm_bg.wasm" ||
    !/^[0-9a-f]{64}$/.test(module?.sha256 ?? "") || !/^[0-9a-f]{64}$/.test(wasm?.sha256 ?? "")) {
    fail("vendored WASM release manifest is invalid");
  }
  if (fileHash(vendorRoot, `wasm/${module.file}`) !== module.sha256) fail("vendored WASM module does not match release.json");
  if (fileHash(vendorRoot, `wasm/${wasm.file}`) !== wasm.sha256) fail("vendored WASM binary does not match release.json");
  console.log(`Verified @tenrai/sdk ${vendorPackage.version} (${release.revision.slice(0, 12)}), ${expected.length} published files.`);
}

try { verify(); }
catch (error) {
  console.error(`@tenrai/sdk installation check failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error("Run npm ci to refresh node_modules from vendor/tenrai-sdk.");
  process.exitCode = 1;
}
