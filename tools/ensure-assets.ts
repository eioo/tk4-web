/**
 * Run the asset pipeline only when it has not been run yet.
 *
 *   bun run assets:ensure
 *
 * `bun run dev` and `bun run start` call this first, so a fresh checkout works
 * with a single command. The presence of `public/assets/manifest.json` is the
 * marker; run `bun run assets` to force a refresh.
 */

import { buildAssets } from "./build-assets";

const manifest = new URL("../public/assets/manifest.json", import.meta.url);

if (await Bun.file(manifest).exists()) {
  process.stdout.write("assets: public/assets already built (bun run assets to refresh)\n");
} else {
  await buildAssets();
}
