/**
 * Pack vocabulary: the identity, display metadata, composition rows, and
 * provider contract every pack surface shares.
 *
 * A **pack** is one installable unit of agent behavior — rules, skills, hooks,
 * commands, subagents, and MCP servers — bound to a workspace rather than to a
 * session. The registry never reads a pack's on-disk layout: a provider
 * resolves whatever format it owns into the {@link PackDefinition} here, so the
 * seam stays independent of any one packaging format.
 *
 * @module @deepseek-ai/dsh-pack/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Identifies one pack across the registry, the workspace binding store, and
 * every wire surface. Branded because it crosses those boundaries as an opaque
 * key that must not be interchangeable with a workspace or skill name.
 */
export type PackId = Branded<'PackId'>

/**
 * One Cordis plugin row a pack contributes to the composition of every session
 * in a bound workspace. The row grammar mirrors an agent preset's
 * `agent.cordis.yml` entry, so a loader that reads hooks, commands, subagents,
 * or MCP servers emits rows the existing mount machinery already understands.
 */
export interface PackRow {
  /** Row identity within one pack; unique per pack so a patch layer can address it. */
  readonly id: string
  /** Module specifier or path the Loader resolves. */
  readonly name: string
  /** Plugin configuration passed to the mounted row. */
  readonly config?: Readonly<Record<string, unknown>>
  /** Whether the row is composed but switched off. */
  readonly disabled?: boolean
}

/** Optional provider-specific base a pack's relative assets resolve against. */
export type PackResourceBase =
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'opaque'; readonly description: string }

/**
 * Display and identity metadata for one pack, without its composition. This is
 * what a gallery renders and what a binding surface lists; loading the rows is
 * a separate {@link PackRegistry.get} call.
 */
export interface PackSummary {
  /** Kebab-case identifier used to address the pack. */
  readonly id: PackId
  /** Display name shown in selection surfaces. */
  readonly name: string
  /** Short description shown beneath the name. */
  readonly description: string
  /** Grouping label a gallery sorts sections by. */
  readonly category: string
  /** Provider-owned version string, shown for support and reported in diagnostics. */
  readonly version: string
  /** Ascending display order within a category; ties fall back to id order. */
  readonly order: number
  /** Optional icon path or URL resolved against {@link PackSummary.resourceBase}. */
  readonly icon?: string
  /** Provider that owns this pack body. */
  readonly provider: string
  /** Provider-specific base for relative assets. */
  readonly resourceBase?: PackResourceBase
}

/**
 * Provider catalog entry used by the registry to merge and later load packs.
 * The registry stores `locator` untouched and hands it back to the winning
 * provider's `get()`.
 */
export interface PackCandidate extends PackSummary {
  /** Lower ranks win a duplicate pack id before provider registration order is considered. */
  readonly rank: number
  /** Opaque provider-owned handle passed back to `provider.get()`. */
  readonly locator: unknown
}

/**
 * A pack with the composition rows a bound session mounts. Returned by
 * {@link PackRegistry.get}; never carried in a catalog listing, because a
 * listing is what an unentitled surface may see.
 */
export interface PackDefinition extends PackSummary {
  /** Composition rows contributed to every session in a bound workspace, in mount order. */
  readonly rows: readonly PackRow[]
}

/**
 * Provider candidates plus whether the current discovery is authoritative. A
 * provider returning a bare array asserts complete discovery.
 */
export interface PackProviderObservation {
  /** Candidates available from the current provider discovery. */
  readonly candidates: readonly PackCandidate[]
  /** Whether discovery completed and these candidates may be cached. */
  readonly complete: boolean
}

/** Caller context for abortable provider work. */
export interface PackLookupOptions {
  /** Abort discovery or loading work for the current caller. */
  readonly signal?: AbortSignal | undefined
}

/** Registration-scoped lifecycle and invalidation capability borrowed by one provider. */
export interface PackProviderControl {
  /** Aborts if registration fails or when the exact provider registration is disposed. */
  readonly signal: AbortSignal
  /** Invalidate cached catalogs and notify consumers only while the exact registration remains active. */
  readonly invalidate: () => void
}

/** Provider interface for one source of packs, such as a bundled directory or a licensed remote service. */
export interface PackProvider {
  /** Unique provider name in the `ctx.packs` registry. */
  readonly name: string
  /**
   * List available pack candidates. Provider plugins register synchronously
   * during `apply()`; remote initialization, authentication, and entitlement
   * filtering are awaited inside this method, so an unentitled pack is simply
   * absent from the catalog rather than filtered by a consumer.
   * @param options - lookup options; `signal` cancels work.
   * @returns candidates as a complete-array shorthand, or an explicit
   *   observation when usable candidates came from incomplete discovery.
   */
  readonly list: (options: PackLookupOptions) => Promise<readonly PackCandidate[] | PackProviderObservation>
  /**
   * Load one previously listed candidate's composition rows.
   * @param candidate - the winning candidate originally returned by this provider.
   * @param options - lookup options; `signal` cancels work.
   * @returns the full pack definition, or `undefined` if it is no longer loadable.
   */
  readonly get: (candidate: PackCandidate, options: PackLookupOptions) => Promise<PackDefinition | undefined>
}

/** One catalog observation plus whether every registered provider completed. */
export interface PackCatalogSnapshot {
  /** Sorted winning summaries collected in this observation. */
  readonly packs: readonly PackSummary[]
  /** Whether every registered provider completed without a concurrent catalog revision. */
  readonly complete: boolean
}
