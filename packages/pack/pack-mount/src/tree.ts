/**
 * The inline entry tree one agent's bound packs mount through.
 *
 * `Include` is the Loader's file-backed tree; a pack's rows arrive in memory
 * from a provider that may have no filesystem, so this subclass takes the rows
 * directly and never reads or writes a file. Everything else — entry creation,
 * ordering, disposal — is the Loader's own machinery.
 *
 * @module @deepseek-ai/dsh-pack-mount/tree
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { EntryGroup, EntryTree } from '@deepseek-ai/cordis-plugin-loader'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'

/** What one mounted tree publishes about itself for the caller's audit to read. */
export interface MountedPackTree {
  /** The tree the rows created. */
  readonly tree: EntryTree
  /**
   * The subtree's own fiber. Captured here rather than taken from
   * `ctx.plugin()`, which hands back a thenable wrapper that is never identical
   * to the fiber appearing in a parent chain.
   */
  readonly fiber: Fiber
}

/**
 * Trees captured by config identity. A subtree plugged directly rather than
 * created as a Loader entry never links itself to an `Entry`, so this is the
 * only handle on the rows it created; config objects are minted per mount, so
 * concurrent mounts cannot collide.
 */
const mounted = new WeakMap<object, MountedPackTree>()

/**
 * Read back the tree one mount created.
 * @param config - the exact config object handed to `ctx.plugin(PackTree, …)`.
 * @returns the tree and its fiber, or `undefined` when that config mounted none.
 */
export function mountedTree(config: object): MountedPackTree | undefined {
  return mounted.get(config)
}

/** The rows one mount contributes. */
export interface PackTreeConfig {
  /** Loader entries, already namespaced so two packs cannot collide on a row id. */
  readonly rows: readonly EntryOptions[]
}

/**
 * An entry tree whose rows come from memory.
 *
 * Unlike `Include`, this tree does not rewrite its context's `baseUrl`, so a
 * bare package name in a row resolves from wherever the host composition
 * resolves its own dependencies — which is what a pack's rows always name.
 */
export class PackTree extends EntryTree {
  static inject = ['loader']

  // Tree-carrier marker, as Include and Group declare: this config is an entry
  // list, so the Loader keeps it literal and a `!!js` expression inside a row's
  // config resolves lazily in that row's own context rather than here.
  static readonly [EntryGroup.key] = true

  /**
   * @param ctx - the agent scope context this tree mounts under.
   * @param config - the rows to create.
   */
  constructor(ctx: Context, public config: PackTreeConfig) {
    super(ctx)
    // EntryTree's constructor files every new tree under the nearest owning
    // Loader entry's `subtree` slot. Left in place, root `loader.entries()`
    // would walk one agent's packs as host entries. Reclaim the slot.
    const owner = this.ctx.fiber.entry
    if (owner?.subtree === this) delete owner.subtree
    mounted.set(config, { tree: this, fiber: ctx.fiber })
  }

  /**
   * A pack tree has no file, so there is nothing to persist. `EntryTree`
   * declares `write()` abstract and the Loader calls it whenever it decides
   * the config changed — including when a row self-disposes and when the agent
   * tears its subtree down.
   */
  write(): void {}

  /**
   * Create the configured rows, and stop them when the agent unwinds.
   * @yields the disposer that stops every row this tree created.
   */
  async* [Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    yield () => this.stop()
    await this.root.update([...this.config.rows])
  }

  /** Dispose every row this tree created. */
  async stop(): Promise<void> {
    await this.root.stop()
  }
}
