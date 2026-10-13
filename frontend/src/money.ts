/** Money display (owner: A). All amounts from the API are USD. */
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** e.g. 140845 -> "$140,845" */
export const formatUsd = (n: number) => usd.format(n);
