// Per-token-type pricing in USD per 1M tokens: [input, cache_write, cache_read, output]
export const PRICING: Record<string, [number, number, number, number]> = {
  haiku:  [0.80,  1.00,  0.08,  4.00],
  sonnet: [3.00,  3.75,  0.30, 15.00],
  opus:   [5.00,  6.25,  0.50, 25.00],
}

// Blended rate ($/M tokens) for when only a total token count is known
export const BLENDED_RATE: Record<string, number> = {
  haiku: 1.44, sonnet: 5.40, opus: 9.00,
}

export function modelTier(model: string): string {
  const m = (model ?? '').toLowerCase()
  for (const key of ['opus', 'sonnet', 'haiku']) {
    if (m.includes(key)) return key
  }
  return 'sonnet'
}

export function computeCost(model: string, input: number, cw: number, cr: number, out: number): number {
  const [pIn, pCw, pCr, pOut] = PRICING[modelTier(model)] ?? PRICING.sonnet
  return (input * pIn + cw * pCw + cr * pCr + out * pOut) / 1_000_000
}
