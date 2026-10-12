/**
 * Fetch the upstream game-data checkout without building assets.
 *
 *   bun run assets:source
 *
 * The test suite reads the original data straight from `tapankaikki4/data/`
 * (via `src/data/__test__/helpers.ts`), not from `public/assets/`, so CI calls
 * this before `bun test`. Idempotent: it clones only when the checkout or its
 * `data/` is missing. `bun run assets` still does the full build.
 */

import { ensureSource } from "./build-assets";

await ensureSource();
