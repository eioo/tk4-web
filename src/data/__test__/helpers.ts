/**
 * Test helpers. Reference data is read from the original checkout in
 * `tapankaikki4/` (gitignored) rather than copied into the repo.
 */

const DATA_ROOT = new URL("../../../tapankaikki4/data/", import.meta.url);

/** Reads a file from the original `data/` directory. */
export async function readRef(rel: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(new URL(rel, DATA_ROOT)).arrayBuffer());
}

/** Reads a text file from the original `data/` directory. */
export async function readRefText(rel: string): Promise<string> {
  return Bun.file(new URL(rel, DATA_ROOT)).text();
}

/** SHA-256 (hex) of a byte buffer. */
export function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}
