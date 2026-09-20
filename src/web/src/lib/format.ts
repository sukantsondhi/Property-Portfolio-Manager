export const money = (pence: unknown) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format((Number(pence) || 0) / 100);
export const date = (value: unknown) => value ? new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric' }).format(new Date(`${String(value).slice(0,10)}T00:00:00`)) : 'Not set';
export const title = (value: string) => value.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
export const initials = (name: string) => name.split(/\s+/).map(v => v[0]).join('').slice(0,2).toUpperCase();

