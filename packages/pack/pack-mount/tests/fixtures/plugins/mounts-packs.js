// A composed row that mounts packs the way the session entry point does: from
// inside a Loader entry, which is what puts a `subtree` slot in reach.
// Import-free on purpose — the Loader resolves entry modules through Node's
// ESM resolver, which cannot see this workspace's TypeScript sources, so the
// test hands the row its mount step through a well-known global.
export const name = 'mounts-packs'

export function apply(ctx) {
  const hook = globalThis[Symbol.for('dsh.pack-mount.row-hook')]
  if (hook !== undefined) ctx.effect(() => hook(ctx))
}
