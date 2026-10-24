// Confidence formulas follow TypeSafe: 1 when all probability sits on one
// outcome, 0 when it is spread evenly (https://docs.typesafe.ai/confidence)

const clamp01 = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

// Clamp to [0, 1] and rescale to sum to 1 (uniform when nothing is left)
export const normalizeProbabilities = (probabilities: number[]) => {
  const clamped = probabilities.map(clamp01);
  const sum = clamped.reduce((acc, p) => acc + p, 0);
  return sum > 0
    ? clamped.map(p => p / sum)
    : clamped.map(() => 1 / clamped.length);
};

export const confidenceForPredicate = (probability: number) =>
  Math.abs(2 * clamp01(probability) - 1);

// Only the top probability counts: (pMax - 1/n) / (1 - 1/n)
export const confidenceForChoice = (probabilities: number[]) => {
  const n = probabilities.length;
  if (n < 2) { return 1; }
  const pMax = Math.max(...probabilities);
  return Math.max(0, (pMax - 1 / n) / (1 - 1 / n));
};

// Levels are ordered, so probability on a neighbouring level costs less
// confidence than probability on a distant one
export const confidenceForScore = (probabilities: number[]) => {
  const n = probabilities.length;
  if (n < 2) { return 1; }
  const mode = indexOfMax(probabilities);
  const spread = probabilities
    .reduce((acc, p, i) => acc + p * Math.abs(i - mode), 0);
  const spreadUniform = probabilities
    .reduce((acc, _, i) => acc + Math.abs(i - mode) / n, 0);
  return Math.max(0, 1 - spread / spreadUniform);
};

export const expectedLevel = (probabilities: number[]) =>
  probabilities.reduce((acc, p, i) => acc + p * i, 0);

export const indexOfMax = (values: number[]) =>
  values.reduce((best, value, i) => value > values[best] ? i : best, 0);
