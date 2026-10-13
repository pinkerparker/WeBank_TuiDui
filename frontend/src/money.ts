/** Money display (owner: A). All amounts from the API are USD. */
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** e.g. 140845 -> "$140,845". A missing amount shows "—" rather than "$NaN". */
export const formatUsd = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? usd.format(n) : '—');
