import { describe, it, expect } from 'vitest';
import { ApiBudget, DEFAULT_DASHBOARD_API_BUDGET } from './api-budget.js';

describe('ApiBudget', () => {
  it('defaults to the standard dashboard budget', () => {
    expect.assertions(2);
    const budget = new ApiBudget();
    expect(budget.snapshot.remaining).toBe(DEFAULT_DASHBOARD_API_BUDGET);
    expect(budget.snapshot.exhausted).toBe(false);
  });

  it('rejects a negative budget', () => {
    expect.assertions(1);
    expect(() => new ApiBudget(-1)).toThrow('non-negative');
  });

  it('allows spending while calls remain', () => {
    expect.assertions(3);
    const budget = new ApiBudget(2);
    expect(budget.canSpend()).toBe(true);
    budget.spend();
    expect(budget.canSpend()).toBe(true);
    budget.spend();
    expect(budget.canSpend()).toBe(false);
  });

  it('never spends below zero', () => {
    expect.assertions(1);
    const budget = new ApiBudget(1);
    budget.spend();
    budget.spend();
    expect(budget.snapshot.remaining).toBe(0);
  });

  it('reports budget exhaustion with a budget reason', () => {
    expect.assertions(2);
    const budget = new ApiBudget(1);
    budget.spend();
    expect(budget.snapshot.exhausted).toBe(true);
    expect(budget.snapshot.exhaustedReason).toBe('budget');
  });

  it('trips permanently on rate limit even with budget remaining', () => {
    expect.assertions(3);
    const budget = new ApiBudget(100);
    budget.markRateLimited();
    expect(budget.canSpend()).toBe(false);
    expect(budget.snapshot.exhausted).toBe(true);
    expect(budget.snapshot.exhaustedReason).toBe('rate-limit');
  });

  it('respects a custom cost per call', () => {
    expect.assertions(2);
    const budget = new ApiBudget(5);
    expect(budget.canSpend(6)).toBe(false);
    expect(budget.canSpend(5)).toBe(true);
  });
});
