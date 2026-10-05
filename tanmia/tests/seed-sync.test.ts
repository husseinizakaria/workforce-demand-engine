import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

describe('reference seed is generated from the engine', () => {
  it('migration matches generator output', () => {
    const path = new URL('../supabase/migrations/20261005000800_reference_data.sql', import.meta.url);
    const before = readFileSync(path, 'utf8');
    execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'scripts/generate-reference-seed.ts'], { cwd: new URL('..', import.meta.url).pathname });
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});
