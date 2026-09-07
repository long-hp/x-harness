/**
 * Pack bindings (`ctx.packBindings`): which packs a workspace directory has
 * turned on.
 *
 * This package owns the durable half of "add plugin X to project A". It stores
 * nothing about a pack itself — only the ids a directory selected — so a
 * binding survives a pack changing, and a pack the catalog no longer serves
 * simply contributes nothing until it returns.
 *
 * @module @deepseek-ai/dsh-pack-binding
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { PackId } from '@deepseek-ai/dsh-pack'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { canonicalPath, readableCanonicalPath } from './paths.ts'
import { packBindingDomainSpec } from './spec.ts'
import type { PackBindingRecord } from './spec.ts'

export { canonicalPath, readableCanonicalPath } from './paths.ts'
export { packBindingDomainSpec, packBindingRecord } from './spec.ts'
export type { PackBindingRecord } from './spec.ts'

/** One directory and the packs it has turned on. */
export interface PackBinding {
  /** Canonical absolute directory path. */
  readonly path: string
  /** Pack ids bound to that directory, in the order they were stored. */
  readonly packIds: readonly PackId[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    packBindings: PackBindings
  }
}

/**
 * Durable `directory → packs` bindings over the domain data form. Reads are
 * synchronous against the domain's in-memory table once a path is
 * canonicalized; writes go through the domain's write chain.
 */
export class PackBindings extends Service {
  static inject = ['storageDomain']

  private domain!: Domain<typeof packBindingDomainSpec>
  private bindings!: KvTable<string, PackBindingRecord>

  /**
   * @param ctx - the context publishing this service.
   */
  constructor(ctx: Context) {
    super(ctx, 'packBindings')
  }

  /** Open the binding domain and keep it open for this service's lifetime. */
  protected async [Service.init](): Promise<void> {
    this.domain = await this.ctx.storageDomain.open(packBindingDomainSpec)
    this.ctx.effect(() => () => this.domain.close(), 'pack-binding.domainClose')
    this.bindings = this.domain.table('bindings')
  }

  /**
   * Read the packs bound to one directory.
   *
   * A directory that cannot be resolved — deleted, or never created — holds no
   * bindings, so this answers empty rather than failing the caller that is
   * about to compose a session in it.
   * @param path - directory path in any spelling.
   * @returns the bound pack ids, empty when the directory has none.
   */
  async for(path: string): Promise<readonly PackId[]> {
    const canonical = await readableCanonicalPath(path)
    if (canonical === undefined) return []
    return this.bindings.get(canonical)?.packIds ?? []
  }

  /**
   * Replace the packs bound to one directory.
   *
   * An empty list removes the record rather than storing an empty one, so
   * "bound to nothing" and "never bound" are one state.
   * @param path - directory path in any spelling; it must exist.
   * @param packIds - the complete new binding list; duplicates collapse, order is kept.
   * @returns the stored binding list.
   * @throws when the directory does not exist or cannot be resolved.
   */
  async set(path: string, packIds: readonly PackId[]): Promise<readonly PackId[]> {
    const canonical = await canonicalPath(path)
    const unique = [...new Set(packIds)]
    if (unique.length === 0) {
      await this.bindings.delete(canonical)
      return []
    }
    await this.bindings.put(canonical, { packIds: unique })
    return unique
  }

  /**
   * Every directory that has packs bound, for a management surface.
   * @returns one entry per bound directory, in storage order.
   */
  list(): readonly PackBinding[] {
    return [...this.bindings.entries()].map(([path, record]) => ({ path, packIds: record.packIds }))
  }
}

export default PackBindings
