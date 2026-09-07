/**
 * Host Remote owner for the pack surfaces: the catalog a gallery renders and
 * the per-directory bindings a project page turns on and off.
 *
 * This package owns presentation and wire concerns only. Which packs exist is
 * the registry's answer, and which of them the current installation may see is
 * each provider's answer — an unentitled pack never enters a catalog, so it
 * cannot reach this controller to be filtered here.
 *
 * @module @deepseek-ai/dsh-api-pack-controller
 */

import { Context } from '@deepseek-ai/cordis'
import { PackId } from '@deepseek-ai/dsh-pack'
import type { PackSummary } from '@deepseek-ai/dsh-pack'
import type {} from '@deepseek-ai/dsh-pack-binding'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type {
  PackBindingListValue,
  PackBindingValue,
  PackCatalogValue,
  PackSummaryView,
} from './types.ts'

export type * from './types.ts'

/** A directory argument every binding verb shares. */
const directorySchema = z.string().min(1)

/** Pack ids a bind request may carry; the grammar itself is the registry's. */
const packsSchema = z.array(z.string().min(1))

/**
 * Project one catalog summary onto its wire view, field by field. The Gateway
 * returns a business result without decoding it, so a provider whose summary
 * carried extra enumerable properties — or the `resourceBase` host path the
 * local provider attaches — would otherwise serialize to the caller.
 * @param summary - one pack summary from the registry catalog.
 * @returns the display facts a selection surface needs, and nothing else.
 */
function summaryView(summary: PackSummary): PackSummaryView {
  return {
    id: summary.id,
    name: summary.name,
    description: summary.description,
    category: summary.category,
    version: summary.version,
    order: summary.order,
    ...summary.icon === undefined ? {} : { icon: summary.icon },
    provider: summary.provider,
  }
}

/** The message a filesystem refusal carries, without its stack. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `pack` Remote namespace. */
    packController: PackController
  }
}

/**
 * Host service backing the generated `ctx.remote.pack` namespace.
 *
 * Reads never fail on a directory: one that cannot be resolved holds no
 * bindings and answers empty, because a project page must render for a folder
 * that moved. A write to such a directory is refused, because binding a pack to
 * a directory that is not there is a caller mistake worth reporting.
 */
export class PackController extends TypertRemoteService {
  static inject = ['typert', 'packs', 'packBindings']

  /** @param ctx - Host context carrying the pack registry and binding store. */
  constructor(ctx: Context) {
    super(ctx, 'packController', { namespace: 'pack' })
  }

  /**
   * Every pack this installation may see, in display order.
   * @param signal - cancels provider discovery for this caller.
   * @returns the catalog plus whether every provider completed.
   */
  @Remote
  async catalog(signal: AbortSignal): Promise<PackCatalogValue> {
    const snapshot = await this.ctx.packs.snapshot({ signal })
    return { packs: snapshot.packs.map(summaryView), complete: snapshot.complete }
  }

  /**
   * Read the packs one directory has turned on.
   * @param directory - directory path in any spelling.
   * @returns the bound pack ids, empty when the directory has none or no longer exists.
   */
  @Remote
  async bindings(directory: string): Promise<PackBindingValue> {
    const path = parseDirectory(directory)
    return { directory, packs: [...await this.ctx.packBindings.for(path)] }
  }

  /**
   * Replace the packs one directory has turned on.
   *
   * The list is complete rather than additive, and an empty list unbinds the
   * directory. An id no provider currently serves is stored as readily as a
   * live one, so an uninstalled pack returns when its provider does.
   * @param directory - directory path in any spelling; it must exist.
   * @param packs - the complete new binding list; duplicates collapse, order is kept.
   * @returns the stored binding list.
   * @throws RemoteError when the request is malformed or the directory cannot be resolved.
   */
  @Remote
  async bind(directory: string, packs: readonly string[]): Promise<PackBindingValue> {
    const path = parseDirectory(directory)
    const ids = parsePacks(packs).map(id => PackId(id))
    try {
      return { directory, packs: [...await this.ctx.packBindings.set(path, ids)] }
    } catch (error) {
      throw new RemoteError(
        'pack/unresolvable-directory',
        `cannot bind packs to "${directory}": ${errorMessage(error)}`,
        { directory },
        { cause: error },
      )
    }
  }

  /**
   * Every directory that has packs bound.
   * @returns one entry per bound directory, keyed by its stored canonical path.
   */
  @Remote
  boundDirectories(): PackBindingListValue {
    return {
      bindings: this.ctx.packBindings.list().map(binding => ({
        directory: binding.path,
        packs: [...binding.packIds],
      })),
    }
  }
}

/**
 * Admit a directory argument.
 * @param directory - the raw wire value.
 * @returns the same path, validated.
 * @throws RemoteError when the value is not a non-empty string.
 */
function parseDirectory(directory: string): string {
  const parsed = directorySchema.safeParse(directory)
  if (!parsed.success) {
    throw new RemoteError('gateway/bad-request', 'a pack binding request requires a non-empty directory path', {})
  }
  return parsed.data
}

/**
 * Admit a bind request's pack list.
 * @param packs - the raw wire value.
 * @returns the same ids, validated.
 * @throws RemoteError when the value is not a list of non-empty strings.
 */
function parsePacks(packs: readonly string[]): string[] {
  const parsed = packsSchema.safeParse(packs)
  if (!parsed.success) {
    throw new RemoteError('gateway/bad-request', 'a pack binding request requires a list of non-empty pack ids', {})
  }
  return parsed.data
}

export default PackController
