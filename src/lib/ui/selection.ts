/** Ids from `anchor` to `target` inclusive, in `order`. Falls back to just the target when the anchor is not in `order`. */
export function rangeIds(order: readonly string[], anchor: string | null, target: string): string[] {
  const t = order.indexOf(target);
  if (t < 0) return [];
  const a = anchor === null ? -1 : order.indexOf(anchor);
  if (a < 0) return [target];
  const [from, to] = a < t ? [a, t] : [t, a];
  return order.slice(from, to + 1);
}

/** New selection with `ids` all added (checked) or all removed (unchecked). */
export function withIds(selected: ReadonlySet<string>, ids: readonly string[], checked: boolean): Set<string> {
  const next = new Set(selected);
  for (const id of ids) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return next;
}
