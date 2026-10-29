/** Character-level diff between a reference name and a variant, via longest common subsequence (case-insensitive). */
export interface DiffPart {
  text: string;
  /** True when this run of the variant is not in the reference name. */
  differs: boolean;
}

export function nameDiff(reference: string, variant: string): DiffPart[] {
  const a = reference.toLowerCase();
  const b = variant.toLowerCase();
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const same = new Array<boolean>(b.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      same[j] = true;
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  const parts: DiffPart[] = [];
  for (let k = 0; k < variant.length; k++) {
    const differs = !same[k];
    const last = parts[parts.length - 1];
    if (last && last.differs === differs) last.text += variant[k];
    else parts.push({ text: variant[k]!, differs });
  }
  return parts;
}
