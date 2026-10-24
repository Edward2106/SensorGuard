export function literalPattern(value) {
  if (typeof value !== 'string' || value.length > 256) throw new Error('Invalid search value');
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
