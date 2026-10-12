const amountFormats = {en: new Intl.NumberFormat('en'), hr: new Intl.NumberFormat('hr')};

/** Exact display of public MON amounts, without Number conversion or truncation. */
export function publicAmount(wei: bigint, hr = false) {
  const digits = wei.toString().padStart(19, '0');
  const integer = amountFormats[hr ? 'hr' : 'en'].format(BigInt(digits.slice(0, -18)));
  const fraction = digits.slice(-18).replace(/0+$/, '');
  return integer + (fraction ? (hr ? ',' : '.') + fraction : '');
}

/** Round nonnegative reward displays to five decimals; underlying wei stay exact. */
export function publicRewardAmount(wei: bigint, hr = false) {
  const unit = 10n ** 13n;
  return publicAmount((wei + unit / 2n) / unit * unit, hr);
}
