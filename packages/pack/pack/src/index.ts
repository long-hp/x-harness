/**
 * Pack provider registry (`ctx.packs`).
 *
 * This package owns the Service Definition role of the pack capability seam.
 * Concrete providers decide where packs come from — a bundled directory, a
 * local authoring root, or a licensed remote service — while this service only
 * merges their catalogs, resolves the winning pack for an id, and loads that
 * pack's composition rows on demand.
 *
 * Entitlement is deliberately not a concept here: a provider lists what the
 * current installation may see, so an unentitled pack never enters a catalog
 * and its rows never reach a consumer that could leak them.
 *
 * @module @deepseek-ai/dsh-pack
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  PackCandidate,
  PackCatalogSnapshot,
  PackDefinition,
  PackId as PackIdBrand,
  PackLookupOptions,
  PackProvider,
  PackProviderControl,
  PackProviderObservation,
  PackSummary,
} from './types.ts'

/** Identifies one pack across boundaries (see `src/types.ts` for the brand rationale). */
export type PackId = PackIdBrand

/**
 * Brand a string as a {@link PackId}. Callers that accept untrusted text
 * validate with {@link isPackId} first; this applies the compile-time brand
 * alone and performs no check.
 * @param id - raw pack id string.
 * @returns the same string, branded at compile time.
 */
export function PackId(id: string): PackId {
  return id as PackId
}

const PACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Whether a string is a valid kebab-case pack id. The grammar matches the
 * skill-name grammar because a pack id also becomes a directory name.
 * @param id - candidate pack id to validate.
 * @returns whether the id matches the public pack-id grammar.
 */
export function isPackId(id: string): boolean {
  return PACK_ID.test(id)
}

export type {
  PackCandidate,
  PackCatalogSnapshot,
  PackDefinition,
  PackLookupOptions,
  PackProvider,
  PackProviderControl,
  PackProviderObservation,
  PackResourceBase,
  PackRow,
  PackSummary,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    packs: PackRegistry
  }

  interface Events {
    /**
     * A pack provider or a provider-backed catalog may have changed. This is an
     * unfiltered invalidation notification; consumers refetch the catalog for
     * their own lookup options. Listener failures are contained and cannot veto
     * the registry mutation.
     * @mode emit
     */
    'packs/change'(): void
  }
}

/** One candidate plus the ordering facts that decide a duplicate id. */
interface IndexedCandidate {
  readonly candidate: PackCandidate
  readonly provider: PackProvider
  readonly providerOrder: number
  readonly localOrder: number
}

/** A registered provider and the order it joined the registry in. */
interface RegisteredProvider {
  readonly provider: PackProvider
  readonly order: number
}

/**
 * Registry of pack providers. It merges provider catalogs into one sorted
 * listing, resolves the winning provider for a duplicate id, and loads
 * composition rows on demand. Registration is effect-based, so a provider
 * unregisters when its plugin unloads.
 */
export class PackRegistry extends Service {
  private readonly providers = new Map<string, RegisteredProvider>()
  private cached: PackCatalogSnapshot | undefined
  private cachedRevision = -1
  private revision = 0
  private nextProviderOrder = 0

  /**
   * @param ctx - the context publishing this service.
   */
  constructor(ctx: Context) {
    super(ctx, 'packs')
  }

  /**
   * Register a borrowed same-process provider synchronously during plugin
   * apply. Duplicate provider names throw; remote initialization and
   * entitlement resolution belong in `list()`. Fiber disposal unregisters the
   * provider and invalidates the cached catalog.
   * @param create - synchronous factory receiving this registration's lifecycle and invalidation control.
   * @returns the exact Cordis effect disposer that unregisters this provider.
   */
  registerProvider(create: (control: PackProviderControl) => PackProvider): () => void {
    const lifecycle = new AbortController()
    // Undefined until the factory returns, because a factory may call
    // `invalidate()` while it is still constructing its provider.
    let provider: PackProvider | undefined
    const control: PackProviderControl = {
      signal: lifecycle.signal,
      invalidate: () => {
        if (provider !== undefined && this.providers.get(provider.name)?.provider === provider) {
          this.invalidate()
        }
      },
    }
    try {
      const created = create(control)
      provider = created
      const { name } = created
      if (this.providers.has(name)) {
        throw new Error(`pack provider "${name}" is already registered`)
      }
      const order = this.nextProviderOrder
      this.nextProviderOrder += 1
      // oxlint-disable-next-line typescript/no-misused-promises -- exact synchronous disposer preserves Cordis effect identity
      return this.ctx.effect(() => {
        this.providers.set(name, { provider: created, order })
        this.invalidate()
        return () => {
          this.providers.delete(name)
          this.invalidate()
          lifecycle.abort(new Error(`pack provider "${name}" disposed`))
        }
      }, 'packs.registerProvider()')
    } catch (error) {
      lifecycle.abort(error)
      throw error
    }
  }

  /**
   * List the winning pack summaries across every registered provider.
   * @param options - lookup options; `signal` cancels discovery.
   * @returns sorted summaries, dropping providers whose discovery failed.
   */
  async list(options: PackLookupOptions = {}): Promise<readonly PackSummary[]> {
    return (await this.snapshot(options)).packs
  }

  /**
   * Observe the current catalog and whether every provider completed.
   * Incomplete observations are never cached, so a consumer may retain its
   * last-good listing and retry.
   * @param options - lookup options; `signal` cancels discovery.
   * @returns sorted summaries plus discovery completeness.
   */
  async snapshot(options: PackLookupOptions = {}): Promise<PackCatalogSnapshot> {
    throwIfAborted(options.signal)
    const cached = this.cachedSnapshot()
    if (cached !== undefined) return cached
    const revision = this.revision
    const { entries, complete } = await this.collect(options)
    throwIfAborted(options.signal)
    const packs = winners(entries).map(entry => entry.candidate as PackSummary)
    const snapshot: PackCatalogSnapshot = { packs, complete }
    if (complete && this.revision === revision) {
      this.cached = snapshot
      this.cachedRevision = revision
    }
    return snapshot
  }

  /**
   * Load one pack's composition rows from the provider that owns the winning
   * candidate for its id.
   * @param id - kebab-case pack id.
   * @param options - lookup options; `signal` cancels discovery and loading.
   * @returns the full definition, or `undefined` when no provider serves the id.
   * @throws TypeError when the id is not kebab-case, or when the winning
   *   provider answers with a definition for a different id.
   */
  async get(id: string, options: PackLookupOptions = {}): Promise<PackDefinition | undefined> {
    if (!isPackId(id)) throw new TypeError(`pack id "${id}" is not kebab-case`)
    throwIfAborted(options.signal)
    const { entries } = await this.collect(options)
    throwIfAborted(options.signal)
    const entry = winners(entries).find(candidate => candidate.candidate.id === id)
    if (entry === undefined) return undefined
    const definition = await entry.provider.get(entry.candidate, options)
    throwIfAborted(options.signal)
    if (definition === undefined) return undefined
    if (definition.id !== id) {
      throw new TypeError(
        `pack provider "${entry.provider.name}" answered id "${definition.id}" for requested pack "${id}"`,
      )
    }
    return definition
  }

  /** Read the cached catalog when it still matches the current registry revision. */
  private cachedSnapshot(): PackCatalogSnapshot | undefined {
    return this.cachedRevision === this.revision ? this.cached : undefined
  }

  /** Ask every provider for its candidates, containing per-provider failures. */
  private async collect(options: PackLookupOptions): Promise<{ entries: IndexedCandidate[]; complete: boolean }> {
    const entries: IndexedCandidate[] = []
    let complete = true
    for (const { provider, order } of [...this.providers.values()]) {
      let output: readonly PackCandidate[] | PackProviderObservation | undefined
      try {
        output = await raceAbort(provider.list(options), options.signal)
      } catch (error) {
        throwIfAborted(options.signal)
        complete = false
        this.ctx.logger.warn(`pack provider "${provider.name}" skipped: ${errorMessage(error)}`)
      }
      if (output === undefined) continue
      const observation = normalizeObservation(output, provider.name)
      if (!observation.complete) complete = false
      let localOrder = 0
      for (const candidate of observation.candidates) {
        validateCandidate(candidate, provider.name)
        entries.push({ candidate, provider, providerOrder: order, localOrder })
        localOrder += 1
      }
    }
    return { entries, complete }
  }

  /** Drop the cached catalog and tell consumers to refetch. */
  private invalidate(): void {
    this.revision += 1
    this.cached = undefined
    this.notifyChange()
  }

  /** Notify catalog observers without making their refresh work load-bearing. */
  private notifyChange(): void {
    for (const callback of this.ctx.events.dispatch('emit', ['packs/change'])) {
      try {
        const returned: unknown = callback()
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`packs/change listener rejected: ${errorMessage(error)}`)
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`packs/change listener threw: ${errorMessage(error)}`)
      }
    }
  }
}

/**
 * Select one winning entry per pack id: lowest rank, then earliest provider
 * registration, then the provider's own listing order. The result is sorted for
 * display by `order` then `id`.
 * @param entries - every candidate collected this observation.
 * @returns the winning entries in display order.
 */
function winners(entries: readonly IndexedCandidate[]): IndexedCandidate[] {
  const byId = new Map<PackId, IndexedCandidate>()
  for (const entry of entries) {
    const held = byId.get(entry.candidate.id)
    if (held === undefined || outranks(entry, held)) byId.set(entry.candidate.id, entry)
  }
  // Ids are unique past the dedupe above, so the id tiebreak needs no equal
  // arm; comparing with `<` alone also keeps the order locale-independent.
  return [...byId.values()].sort((left, right) =>
    left.candidate.order - right.candidate.order
    || (left.candidate.id < right.candidate.id ? -1 : 1))
}

/** Whether `challenger` beats `held` for the same pack id. */
function outranks(challenger: IndexedCandidate, held: IndexedCandidate): boolean {
  if (challenger.candidate.rank !== held.candidate.rank) return challenger.candidate.rank < held.candidate.rank
  if (challenger.providerOrder !== held.providerOrder) return challenger.providerOrder < held.providerOrder
  return challenger.localOrder < held.localOrder
}


/**
 * Accept a provider's bare-array shorthand or its explicit observation.
 * @param output - whatever the provider's `list()` resolved to.
 * @param providerName - provider name used in the failure message.
 * @returns the normalized observation.
 * @throws TypeError when the value is neither form.
 */
function normalizeObservation(
  output: readonly PackCandidate[] | PackProviderObservation,
  providerName: string,
): PackProviderObservation {
  if (Array.isArray(output)) return { candidates: output, complete: true }
  const observation = output as Partial<PackProviderObservation>
  if (!Array.isArray(observation.candidates) || typeof observation.complete !== 'boolean') {
    throw new TypeError(
      `pack provider "${providerName}" list() must return an array or { candidates, complete } observation`,
    )
  }
  return observation as PackProviderObservation
}

/**
 * Reject a malformed candidate where the provider that produced it can still be
 * named, rather than letting it reach a gallery as a blank card.
 * @param candidate - one candidate returned by a provider.
 * @param providerName - provider name used in the failure message.
 * @throws TypeError naming the provider and the offending field.
 */
function validateCandidate(candidate: PackCandidate, providerName: string): void {
  const fail = (reason: string): never => {
    throw new TypeError(`pack provider "${providerName}" produced an invalid candidate: ${reason}`)
  }
  if (typeof candidate.id !== 'string' || !isPackId(candidate.id)) fail(`id "${String(candidate.id)}" is not kebab-case`)
  // `description` may be empty: a pack that publishes no description still
  // renders as a name-only card, and refusing it would hide a usable pack.
  for (const field of ['name', 'category', 'version'] as const) {
    if (typeof candidate[field] !== 'string' || candidate[field].length === 0) {
      fail(`pack "${candidate.id}" has an empty ${field}`)
    }
  }
  for (const field of ['order', 'rank'] as const) {
    if (!Number.isFinite(candidate[field])) fail(`pack "${candidate.id}" has a non-finite ${field}`)
  }
  if (candidate.provider !== providerName) {
    fail(`pack "${candidate.id}" claims provider "${candidate.provider}"`)
  }
}

/** Settle as soon as the caller aborts, so an uncooperative provider cannot hang a listing. */
async function raceAbort<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return await work
  return await Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(toError(signal.reason)) }, { once: true })
    }),
  ])
}

/** Stop the caller's own work at an abort, before a provider result is used. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw toError(signal.reason)
}

/** Normalize an unknown rejection reason into an Error. */
function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

/** Message text for a contained provider failure. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default PackRegistry
