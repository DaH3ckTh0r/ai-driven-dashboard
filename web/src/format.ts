/** "5 min ago" style label. Takes `nowMs` so a list renders consistently within one refresh. */
export function relative(iso: string | undefined, nowMs: number): string {
  if (!iso) return "never";
  const s = Math.round((nowMs - new Date(iso).getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : new Date(iso).toLocaleDateString();
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function label(text: string): string {
  return text.replace(/-/g, " ");
}
