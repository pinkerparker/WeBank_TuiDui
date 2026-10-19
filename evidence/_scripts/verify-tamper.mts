/**
 * Tamper-detection check (read-only against source; only reads the two JSONL copies
 * under evidence/tamper/ given on argv). Scratch tooling for submission item 6.
 */
import { AuditLog } from '../../server/src/store/auditLog';

const [label, path] = process.argv.slice(2);
if (!label || !path) {
  console.log('usage: tsx verify-tamper.ts <label> <path-to-jsonl>');
  process.exit(1);
}

try {
  const log = new AuditLog(path);
  log.hydrate();
  console.log(`[${label}] hydrate() OK — ${log.length} entries loaded, verify()=${log.verify()}`);
} catch (e) {
  const err = e as Error;
  console.log(`[${label}] hydrate() REJECTED — ${err.name}: ${err.message}`);
}
