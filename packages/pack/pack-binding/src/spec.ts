/**
 * The pack-binding domain declaration: which packs a workspace directory has
 * turned on, and the `defineDomain` spec the service opens.
 *
 * Records are keyed by canonical directory path rather than by workspace id,
 * because `dsh-workspace` is mounted only by the browser application while
 * this binding must hold for every profile that can open a session in that
 * directory.
 *
 * @module @deepseek-ai/dsh-pack-binding/spec
 */

import { z } from 'zod'
import type { PackId } from '@deepseek-ai/dsh-pack'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Pack id schema at the durable boundary; branding has no runtime representation. */
const packId = z.string().transform(value => value as PackId)

/**
 * Durable shape of one directory's bindings. A directory with no packs holds
 * no record at all, so an empty list is never a stored state.
 */
export const packBindingRecord = z.object({
  packIds: z.array(packId),
})

/** One stored binding record, inferred from {@link packBindingRecord}. */
export type PackBindingRecord = z.infer<typeof packBindingRecord>

/**
 * The pack-binding domain spec: one `bindings` table keyed by canonical
 * directory path. There is no global singleton — the table is the whole state,
 * and its absence is the honest representation of "nothing is bound".
 */
export const packBindingDomainSpec = defineDomain({
  name: 'pack_binding',
  version: 1,
  tables: { bindings: domainTable<string, PackBindingRecord>(packBindingRecord) },
})
