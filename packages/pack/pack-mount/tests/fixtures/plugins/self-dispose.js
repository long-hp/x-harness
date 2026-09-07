// Disposes itself once active. The Loader treats a self-disposing entry as a
// config change and writes the tree back through `EntryTree.write()` — which
// for a pack tree must be a no-op, since a pack tree has no file.
export const name = 'self-dispose'
export function apply(ctx) {
  globalThis.__PACK_SELF_DISPOSED__ = new Promise((resolve) => {
    setTimeout(() => { ctx.fiber.dispose(); resolve(undefined) }, 0)
  })
}
