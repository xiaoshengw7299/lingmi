export function yuan(cents?: number | null) {
  const n = Number(cents || 0);
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  return `${sign}${(v / 100).toFixed(2)}`;
}

export function time(v?: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
