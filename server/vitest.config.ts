import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { env: { NODE_ENV: 'test', AUDIT_LOG: '../logs/test-audit.jsonl' } } });
