import { describe, expect, it } from 'vitest';
import { MAX_LIMIT, TransactionsQuerySchema } from './transactions';

describe('TransactionsQuerySchema', () => {
  it('defaults to the first window when no paging params are given', () => {
    const result = TransactionsQuerySchema.parse({});

    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });

  it('coerces limit/offset from query-string values', () => {
    const result = TransactionsQuerySchema.parse({ limit: '500', offset: '1000' });

    expect(result.limit).toBe(500);
    expect(result.offset).toBe(1000);
  });

  it('accepts a chunk up to the maximum limit', () => {
    const result = TransactionsQuerySchema.parse({ limit: String(MAX_LIMIT) });

    expect(result.limit).toBe(MAX_LIMIT);
  });

  it('rejects a limit above the maximum', () => {
    const result = TransactionsQuerySchema.safeParse({ limit: String(MAX_LIMIT + 1) });

    expect(result.success).toBe(false);
  });

  it('rejects a non-positive limit and a negative offset', () => {
    expect(TransactionsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(TransactionsQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
  });
});
