/** "1 deadline" / "2 deadlines": count plus the right noun form. Client-safe (no imports). */
export const plural = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
