export type GateAction = 'write' | 'review' | 'drop';

export type GateThresholds = {
  write: number
  review: number
};

// Conservative until thresholds are calibrated against labeled photos
export const GATE_THRESHOLDS_DEFAULT: GateThresholds = {
  write: 0.8,
  review: 0.5,
};

export const gate = (
  value: number,
  thresholds: GateThresholds = GATE_THRESHOLDS_DEFAULT,
): GateAction =>
  value >= thresholds.write
    ? 'write'
    : value >= thresholds.review
      ? 'review'
      : 'drop';
