let DEBUG_ENABLED = (process.env.DEBUG ?? "").toLowerCase() === "true";

export function setDebug(v: boolean) {
  DEBUG_ENABLED = v;
}

export function isDebug() {
  return DEBUG_ENABLED;
}

export function debug(...args: any[]) {
  if (!DEBUG_ENABLED) return;
  const ts = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.log(`[debug ${ts}]`, ...args);
}
