import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The synchronous migration-registry surface for the CHECK layer. It lives in
// the engine lib — not migrations/ — because pack checks consult it
// (`migrationActive` gates an in-flight transition's legacy tolerance) and a
// pack imports only its own files and the engine surface (pack-independence):
// the canon-internal migrations/ tree is never vendored, so an import into it
// would crash every vendored consumer. Self-locating relative to the engine
// root, so in a vendored consumer — where migrations/ is absent by design —
// every query answers "no active migrations": a flipped member runs the
// canonical shapes, no tolerance needed. The full registry
// (migrations/registry.mjs) builds on this same surface canon-side.
export const MIGRATIONS_SUBDIR = 'active_migrations';
const specsDir = join(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))), 'migrations', MIGRATIONS_SUBDIR); // <canon>/engine/checks/helpers/
export const isSpec = (f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs');
// Tolerant of an absent/empty folder — a vendored consumer, or a canon
// checkout after every record has retired.
export const specFiles = () => { try { return readdirSync(specsDir).filter(isSpec).sort(); } catch { return []; } };

// True while a migration whose file name carries `slug` is still present — a
// check consults it to know whether an in-flight transition's legacy shape is
// still tolerated. When the census auto-retires the migration (deletes the
// file), this flips to false and the tolerance vanishes with it: the resolver
// pattern, expressed synchronously (checks run synchronously and cannot await
// the async spec loader).
export function migrationActive(slug) {
  return specFiles().some((f) => f.includes(slug));
}
