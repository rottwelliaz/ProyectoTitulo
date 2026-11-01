// Preserve numeric input without rounding; callers apply their own validation.
export const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
};
