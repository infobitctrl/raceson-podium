/** Exact display of public MON amounts, without Number conversion or truncation. */
export function publicAmount(wei: bigint, hr = false) {
  const digits = wei.toString().padStart(19, '0');
  const integer = new Intl.NumberFormat(hr ? 'hr' : 'en').format(BigInt(digits.slice(0, -18)));
  const fraction = digits.slice(-18).replace(/0+$/, '');
  return integer + (fraction ? (hr ? ',' : '.') + fraction : '');
}
