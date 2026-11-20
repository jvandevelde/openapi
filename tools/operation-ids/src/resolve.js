/**
 * Collision resolution by symmetric widening.
 *
 * Every candidate starts at level 0. While any name is shared by two or more
 * candidates, or matches a reserved (already existing) id, *every* candidate
 * in that clash moves up one level. Because all members of a clash are
 * treated identically and candidates are processed in a canonical order, the
 * result depends only on the set of operations, never on document order.
 *
 * Names are compared case-insensitively, since many code generators would
 * otherwise produce clashing method names (e.g. getUser vs GetUser).
 */
export function resolveNames(candidates, reserved = new Set()) {
  const reservedLower = new Set([...reserved].map((n) => n.toLowerCase()));
  const levels = candidates.map(() => 0);
  for (let iteration = 0; iteration < 10_000; iteration++) {
    const names = candidates.map((c, i) => c.nameAt(levels[i]));
    const groups = new Map();
    names.forEach((n, i) => {
      const k = n.toLowerCase();
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });
    const bump = [];
    for (const [k, members] of groups) {
      if (members.length > 1 || reservedLower.has(k)) bump.push(...members);
    }
    if (bump.length === 0) return names;
    for (const i of bump) levels[i]++;
  }
  throw new Error('operationId resolution did not converge');
}
