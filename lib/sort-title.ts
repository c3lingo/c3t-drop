export default function sortTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(a|an|the|der|die|das) /, '')
    .replace(/[^\p{Letter}\p{Number}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
