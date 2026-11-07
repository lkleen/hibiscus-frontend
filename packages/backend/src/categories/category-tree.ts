/** True when `parentId` is `id` itself or has `id` among its ancestors (`parents`: id → parent id). */
export function createsCycle(
  id: number,
  parentId: number | null,
  parents: Map<number, number | null>,
): boolean {
  const visited: Set<number> = new Set<number>();
  let current: number | null = parentId;
  while (current !== null) {
    if (current === id) return true;
    if (visited.has(current)) throw new Error(`umsatztyp ${current} is part of a parent loop`);
    visited.add(current);
    current = parents.get(current) ?? null;
  }
  return false;
}
