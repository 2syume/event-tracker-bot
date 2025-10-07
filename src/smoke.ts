import { assertConfig } from "./config";
import { setDebug } from "./debug";
import { processTweetUrl } from "./pipeline";

async function main() {
  if (process.argv.includes("--debug")) setDebug(true);
  assertConfig();
  const url =
    process.argv[2] ??
    "https://x.com/curtaindamashii/status/1975033367268872542";
  console.log("[smoke] Testing pipeline with:", url);
  try {
    const res = await processTweetUrl(url);
    console.log("[smoke] isEvent:", res.extracted.isEvent);
    console.log("[smoke] title:", res.extracted.title ?? "(none)");
    console.log("[smoke] images:", (res.extracted.images ?? []).length);
    console.log("[smoke] sheet:", res.sheets);
    if (!res.extracted.isEvent) {
      console.log(
        "[smoke] Not classified as event. This is still a successful run."
      );
    }
    process.exit(0);
  } catch (e) {
    console.error("[smoke] Failed:", (e as Error).message);
    process.exit(1);
  }
}

main();
