import { describe, expect, it } from 'vitest';

import { auditExitCode, auditLimits, safeReceiptCursor } from './audit.js';
import { parseArguments } from './main.js';

import type { AuditReport } from './audit.js';

describe('Doctor command contract', () => {
  const base = ['--user', 'account', '--database', 'neuron'];
  it('requires explicit scope and preserves documented defaults', () => {
    const parsed = parseArguments(base);
    expect(parsed.database).toBe('neuron');
    expect(auditLimits(parsed.options)).toEqual({
      pageSize: 100,
      maxItems: 1000,
      maxEvents: 2000,
      statementMs: 5000,
      budgetMs: 60000,
    });
  });
  it.each([
    [],
    ['--user', 'account'],
    ['--database', 'neuron'],
    [...base, '--repair'],
    [...base, '--user', 'another'],
    [...base, '--page-size', '0'],
    [...base, '--max-events', '10001'],
    [...base, '--budget-ms', 'Infinity'],
    [...base, '--statement-ms', '1.2'],
    [...base, '--details', '--details'],
    [...base, '--card', 'bad'],
    [...base, '--deep', '--card', 'not-uuid'],
    [...base, '--deep', '--after-receipt', 'private-content'],
  ])('rejects ambiguous, write-mode or unbounded arguments (%j)', (...args: string[]) => {
    expect(() => parseArguments(args)).toThrow();
  });
  it('validates bounds for library callers and recognizes only content-free receipt cursors', () => {
    expect(() => auditLimits({ userId: ' ', deep: true })).toThrow();
    expect(() => auditLimits({ userId: 'a', maxItems: NaN })).toThrow();
    expect(safeReceiptCursor('a'.repeat(64))).toBe(true);
    expect(safeReceiptCursor('review-undo:12345678-1234-1234-1234-123456789012')).toBe(true);
    expect(safeReceiptCursor('postgresql://secret')).toBe(false);
  });
  it('never returns a passing exit code for partial, failed or interrupted output', () => {
    const report = { status: 'complete', findings: [] } as unknown as AuditReport;
    expect(auditExitCode(report)).toBe(0);
    expect(
      auditExitCode({
        ...report,
        findings: [{ check: 'x', count: 1, severity: 'warning', context: 'legacy' }],
      }),
    ).toBe(0);
    expect(
      auditExitCode({
        ...report,
        findings: [{ check: 'x', count: 1, severity: 'error', context: 'invalid' }],
      }),
    ).toBe(1);
    expect(auditExitCode({ ...report, status: 'incomplete' })).toBe(2);
    expect(auditExitCode({ ...report, status: 'failed' })).toBe(2);
    expect(auditExitCode({ ...report, status: 'interrupted' })).toBe(130);
  });
});
