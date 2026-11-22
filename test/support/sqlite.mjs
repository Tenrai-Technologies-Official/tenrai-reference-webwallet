// Suppress Node's experimental SQLite notice in these tests.
const original = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  const text = typeof warning === "string" ? warning : warning.message;
  if (!text.startsWith("SQLite is an experimental feature")) Reflect.apply(original, process, [warning, ...rest]);
};
const sqlite = await import("node:sqlite");
process.emitWarning = original;

export const { DatabaseSync } = sqlite;
