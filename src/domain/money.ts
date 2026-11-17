export function assertCents(value: number, signed = false): number {
  if (!Number.isSafeInteger(value) || (!signed && value < 0)) throw new RangeError('金额必须为安全整数分');
  return value;
}
export function parseMoney(text: string): number {
  const clean = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) throw new RangeError('请输入非负金额，最多两位小数');
  const [whole, decimal = ''] = clean.split('.');
  const cents = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('金额过大');
  return Number(cents);
}
export function formatMoney(cents: number): string {
  assertCents(cents, true);
  const absolute = BigInt(cents < 0 ? -cents : cents);
  return `${cents < 0 ? '-' : ''}¥${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
export function sumCents(values: readonly number[], signed = false): number {
  return values.reduce((sum, value) => assertCents(sum + assertCents(value, signed), signed), 0);
}
