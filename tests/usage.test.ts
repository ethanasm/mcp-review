import { describe, expect, it } from 'vitest';
import { createUsageTracker } from '../src/usage.js';

describe('createUsageTracker', () => {
  it('starts with zero usage', () => {
    const tracker = createUsageTracker('claude-sonnet-4-20250514');
    const total = tracker.getTotal();
    expect(total.inputTokens).toBe(0);
    expect(total.outputTokens).toBe(0);
    expect(total.estimatedCost).toBe(0);
  });

  it('accumulates usage across multiple calls', () => {
    const tracker = createUsageTracker('claude-sonnet-4-20250514');
    tracker.addUsage(1000, 500);
    tracker.addUsage(2000, 1000);

    const total = tracker.getTotal();
    expect(total.inputTokens).toBe(3000);
    expect(total.outputTokens).toBe(1500);
  });

  describe('cost calculation', () => {
    it('calculates cost for claude-sonnet-4-20250514', () => {
      // $3/MTok input, $15/MTok output
      const tracker = createUsageTracker('claude-sonnet-4-20250514');
      tracker.addUsage(1_000_000, 1_000_000);

      const total = tracker.getTotal();
      expect(total.estimatedCost).toBeCloseTo(18, 2); // $3 + $15
    });

    it('calculates cost for claude-opus-4-20250514', () => {
      // $15/MTok input, $75/MTok output
      const tracker = createUsageTracker('claude-opus-4-20250514');
      tracker.addUsage(1_000_000, 1_000_000);

      const total = tracker.getTotal();
      expect(total.estimatedCost).toBeCloseTo(90, 2); // $15 + $75
    });

    it('calculates cost for claude-haiku-3-5-20241022', () => {
      // $0.80/MTok input, $4/MTok output
      const tracker = createUsageTracker('claude-haiku-3-5-20241022');
      tracker.addUsage(1_000_000, 1_000_000);

      const total = tracker.getTotal();
      expect(total.estimatedCost).toBeCloseTo(4.8, 2); // $0.80 + $4
    });

    it('uses default pricing for unknown model', () => {
      // Default: $3/MTok input, $15/MTok output
      const tracker = createUsageTracker('some-unknown-model');
      tracker.addUsage(1_000_000, 1_000_000);

      const total = tracker.getTotal();
      expect(total.estimatedCost).toBeCloseTo(18, 2); // $3 + $15
    });

    it('handles fractional token counts', () => {
      const tracker = createUsageTracker('claude-sonnet-4-20250514');
      tracker.addUsage(1234, 567);

      const total = tracker.getTotal();
      // (1234 / 1M) * 3 + (567 / 1M) * 15 = 0.003702 + 0.008505 = 0.012207
      expect(total.estimatedCost).toBeCloseTo(0.012207, 5);
    });
  });

  describe('edge cases', () => {
    it('handles zero tokens in addUsage', () => {
      const tracker = createUsageTracker('claude-sonnet-4-20250514');
      tracker.addUsage(0, 0);

      const total = tracker.getTotal();
      expect(total.inputTokens).toBe(0);
      expect(total.outputTokens).toBe(0);
      expect(total.estimatedCost).toBe(0);
    });

    it('accumulates correctly over many calls', () => {
      const tracker = createUsageTracker('claude-sonnet-4-20250514');

      // Simulate a 10-turn conversation
      for (let i = 0; i < 10; i++) {
        tracker.addUsage(500, 200);
      }

      const total = tracker.getTotal();
      expect(total.inputTokens).toBe(5000);
      expect(total.outputTokens).toBe(2000);
    });

    it('handles very large token counts without overflow', () => {
      const tracker = createUsageTracker('claude-sonnet-4-20250514');
      tracker.addUsage(100_000_000, 50_000_000);

      const total = tracker.getTotal();
      expect(total.inputTokens).toBe(100_000_000);
      expect(total.outputTokens).toBe(50_000_000);
      // (100M / 1M) * 3 + (50M / 1M) * 15 = 300 + 750 = 1050
      expect(total.estimatedCost).toBeCloseTo(1050, 2);
    });

    it('getTotal returns a snapshot (not a live reference)', () => {
      const tracker = createUsageTracker('claude-sonnet-4-20250514');
      tracker.addUsage(100, 50);

      const snapshot = tracker.getTotal();
      tracker.addUsage(200, 100);

      // The snapshot should not have changed
      expect(snapshot.inputTokens).toBe(100);
      expect(snapshot.outputTokens).toBe(50);

      // But a new call to getTotal should reflect the update
      const updated = tracker.getTotal();
      expect(updated.inputTokens).toBe(300);
      expect(updated.outputTokens).toBe(150);
    });
  });

  describe('formatUsage', () => {
    it('formats with comma-separated numbers and dollar cost', () => {
      const tracker = createUsageTracker('claude-sonnet-4-20250514');
      tracker.addUsage(1234, 567);

      const formatted = tracker.formatUsage();
      expect(formatted).toBe('Tokens: 1,234 in / 567 out | Estimated cost: $0.01');
    });

    it('formats zero usage', () => {
      const tracker = createUsageTracker('claude-sonnet-4-20250514');
      const formatted = tracker.formatUsage();
      expect(formatted).toBe('Tokens: 0 in / 0 out | Estimated cost: $0.00');
    });

    it('formats large numbers', () => {
      const tracker = createUsageTracker('claude-opus-4-20250514');
      tracker.addUsage(1_500_000, 250_000);

      const formatted = tracker.formatUsage();
      // (1.5M / 1M) * 15 + (0.25M / 1M) * 75 = 22.5 + 18.75 = 41.25
      expect(formatted).toBe('Tokens: 1,500,000 in / 250,000 out | Estimated cost: $41.25');
    });
  });
});
