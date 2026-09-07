/**
 * Pack mounting (`ctx.packMount`): compose one agent from the packs its
 * workspace directory has turned on.
 *
 * This package is the step that makes a binding mean something. It reads the
 * directory's bound pack ids, loads each pack's composition rows, and mounts
 * them under the agent's scope context — the same mechanism agent presets use,
 * which is what keeps a pack's tools, prompt sections, skills, and listeners
 * inside the sessions of that one workspace.
 *
 * @module @deepseek-ai/dsh-pack-mount
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-pack'
import type { PackDefinition, PackId } from '@deepseek-ai/dsh-pack'
import type {} from '@deepseek-ai/dsh-pack-binding'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { EntryTree } from '@deepseek-ai/cordis-plugin-loader'
import { mountedTree, PackTree } from './tree.ts'

export { PackTree } from './tree.ts'
export type { PackTreeConfig } from './tree.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    packMount: PackMount
  }
}

/**
 * Rows that never reached a usable state.
 *
 * A directly-plugged subtree is absent from `ctx.loader.entries()`, so no boot
 * audit covers it: a row still waiting for a service it injected would sit
 * silently inert while the user believes the pack they turned on is active.
 * The Loader already rejects a row whose module or plugin threw, so the one
 * remaining shape is an enabled row with unresolved injections.
 *
 * `dsh-agent-presets` applies the same rule to preset rows. The two are
 * deliberate duplicates rather than a shared import: that package is mounted
 * only by the browser application, and packs must compose in every profile.
 * They have to stay in step; a shared home for this predicate is the better
 * eventual fix.
 * @param tree - the mounted tree to audit.
 * @returns one line per unusable row, naming the row and what it waits for.
 */
function inactiveRows(tree: EntryTree): string[] {
  const lines: string[] = []
  for (const entry of tree.entries()) {
    if (entry.disabled) continue
    const { fiber } = entry
    /* v8 ignore next 4 -- the Loader rejects an entry whose module or plugin failed,
       so a settled tree never holds an enabled fiber-less entry; the branch exists
       only because `Entry.fiber` is declared optional. */
    if (fiber === undefined) {
      lines.push(`${entry.options.id} (${entry.options.name}): never started`)
      continue
    }
    const missing = Object.keys(fiber.inject).filter(name => fiber.ctx.get(name) === undefined)
    if (missing.length > 0) {
      lines.push(`${entry.options.id} (${entry.options.name}): waiting for ${missing.join(', ')}`)
    }
  }
  return lines
}

/** Separator between a pack id and the row id it published. */
const ROW_SEPARATOR = '.'

/**
 * Namespace one pack's rows so two packs bound to one directory cannot collide
 * on a row id the Loader rejects as a duplicate.
 * @param definition - the loaded pack.
 * @returns the pack's rows as Loader entries.
 */
function entriesOf(definition: PackDefinition): EntryOptions[] {
  return definition.rows.map(row => ({
    id: `${definition.id}${ROW_SEPARATOR}${row.id}`,
    name: row.name,
    ...row.config === undefined ? {} : { config: { ...row.config } },
    ...row.disabled === undefined ? {} : { disabled: row.disabled },
  }))
}

/**
 * Composes an agent from the packs bound to its workspace directory.
 *
 * The service is optional in every composition: a deployment that mounts no
 * pack rows simply never publishes it, and the session entry point that asks
 * for it through `ctx.get('packMount')` gets `undefined` and composes as
 * before.
 */
export class PackMount extends Service {
  static inject = ['packs', 'packBindings']

  /**
   * @param ctx - the context publishing this service.
   */
  constructor(ctx: Context) {
    super(ctx, 'packMount')
  }

  /**
   * Mount every pack bound to one directory under an agent's scope.
   *
   * A bound pack the catalog no longer serves is logged and skipped rather
   * than failing session creation: an uninstalled or unentitled pack must not
   * make a workspace unopenable. A pack whose rows fail to activate does fail
   * the mount, because a half-composed agent would run without the behavior
   * the user turned on and with no sign that anything was missing.
   * @param agentCtx - the agent's scope context, from the agent factory's `setup`.
   * @param cwd - the session's working directory.
   * @throws when `agentCtx` carries no scope, or when a bound pack's rows do not activate.
   */
  async mount(agentCtx: Context, cwd: string): Promise<void> {
    if (scopeOf(agentCtx) === undefined) {
      throw new Error(
        'pack-mount: refusing to mount packs into an unscoped context; '
        + 'their registrations would apply to every agent in the process',
      )
    }
    const packIds = await this.ctx.packBindings.for(cwd)
    if (packIds.length === 0) return
    const rows = await this.rowsFor(packIds)
    if (rows.length === 0) return

    const config = { rows }
    const handle = agentCtx.plugin(PackTree, config)
    try {
      await handle.await()
      const subtree = mountedTree(config)
      /* v8 ignore next -- the constructor runs before `await()` settles for every mounted tree */
      if (subtree === undefined) throw new Error('mounted pack tree did not publish its entry tree')
      const unusable = inactiveRows(subtree.tree)
      if (unusable.length > 0) {
        throw new Error(`pack row(s) did not activate:\n${unusable.join('\n')}`)
      }
    } catch (error) {
      await handle.dispose()
      throw error
    }
  }

  /** Load each bound pack, dropping the ones the catalog no longer serves. */
  private async rowsFor(packIds: readonly PackId[]): Promise<EntryOptions[]> {
    const rows: EntryOptions[] = []
    for (const packId of packIds) {
      const definition = await this.ctx.packs.get(packId)
      if (definition === undefined) {
        this.ctx.logger.warn(`bound pack "${packId}" is not served by any provider; skipping it`)
        continue
      }
      rows.push(...entriesOf(definition))
    }
    return rows
  }
}

export default PackMount
