export function clip(text: string, max = 1200): string {
  return text.length > max ? `${text.slice(0, max)}...[truncated]` : text;
}
