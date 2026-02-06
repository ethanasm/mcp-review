interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-20250514': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-opus-4-20250514': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-haiku-3-5-20241022': { inputPerMTok: 0.8, outputPerMTok: 4 },
};

const DEFAULT_PRICING: ModelPricing = { inputPerMTok: 3, outputPerMTok: 15 };

export interface UsageTracker {
  addUsage(inputTokens: number, outputTokens: number): void;
  getTotal(): TokenUsage;
  formatUsage(): string;
}

export function createUsageTracker(model: string): UsageTracker {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  let totalInput = 0;
  let totalOutput = 0;

  function calculateCost(inputTokens: number, outputTokens: number): number {
    const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMTok;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMTok;
    return inputCost + outputCost;
  }

  return {
    addUsage(inputTokens: number, outputTokens: number): void {
      totalInput += inputTokens;
      totalOutput += outputTokens;
    },

    getTotal(): TokenUsage {
      return {
        inputTokens: totalInput,
        outputTokens: totalOutput,
        estimatedCost: calculateCost(totalInput, totalOutput),
      };
    },

    formatUsage(): string {
      const total = this.getTotal();
      const inputFormatted = total.inputTokens.toLocaleString('en-US');
      const outputFormatted = total.outputTokens.toLocaleString('en-US');
      const costFormatted = `$${total.estimatedCost.toFixed(2)}`;
      return `Tokens: ${inputFormatted} in / ${outputFormatted} out | Estimated cost: ${costFormatted}`;
    },
  };
}
