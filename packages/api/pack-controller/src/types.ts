/**
 * Browser-safe wire vocabulary of the pack surfaces this package serves.
 *
 * The views here are deliberately narrower than the seam's own `PackSummary`:
 * a catalog entry crosses to a browser, so it carries display text and identity
 * and never a provider's `resourceBase`, which for the local provider is an
 * absolute host path.
 *
 * @module @deepseek-ai/dsh-api-pack-controller/types
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * A binding write was refused because its directory could not be resolved:
     * it does not exist, or it is not reachable by this process. Reading an
     * unresolvable directory is not an error — it answers "nothing bound" —
     * so this code only ever comes from a write.
     */
    'pack/unresolvable-directory': { readonly directory: string }
  }
}

/** One pack as a selection surface renders it. */
export interface PackSummaryView {
  /** Kebab-case identifier the binding verbs address. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** Short description shown beneath the name; empty when the pack declares none. */
  readonly description: string
  /** Grouping label a gallery sorts sections by. */
  readonly category: string
  /** Provider-owned version string, shown for support. */
  readonly version: string
  /** Ascending display order within a category. */
  readonly order: number
  /** Icon path or URL as the pack declared it, unresolved. */
  readonly icon?: string
  /** Provider that owns this pack body. */
  readonly provider: string
}

/** Every pack the current installation may see, plus whether discovery was authoritative. */
export interface PackCatalogValue {
  /** Winning summaries in display order. */
  readonly packs: readonly PackSummaryView[]
  /**
   * Whether every registered provider completed. A surface that reads `false`
   * is looking at a partial catalog and should keep its own last-good listing
   * rather than treat a missing pack as uninstalled.
   */
  readonly complete: boolean
}

/** The packs one directory has turned on. */
export interface PackBindingValue {
  /** The directory as the caller spelled it, not the stored canonical key. */
  readonly directory: string
  /** Bound pack ids, in binding order; empty when the directory has none. */
  readonly packs: readonly string[]
}

/** Every directory that has packs bound, for a management surface. */
export interface PackBindingListValue {
  /** One entry per bound directory, each keyed by its stored canonical path. */
  readonly bindings: readonly PackBindingValue[]
}
