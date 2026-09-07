/**
 * Local pack provider: serve packs from directories on this host.
 *
 * This package owns one Service Provider role of the pack seam. It reads pack
 * directories under configured roots and answers `ctx.packs` with their display
 * metadata and, on demand, the composition rows their contents produce.
 *
 * @module @deepseek-ai/dsh-pack-local
 */

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { isPackId, PackId } from '@deepseek-ai/dsh-pack'
import type { PackCandidate, PackDefinition, PackProvider, PackProviderObservation } from '@deepseek-ai/dsh-pack'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { scanRoot } from './discovery.ts'
import type { DiscoveredPack } from './discovery.ts'
import { buildRows } from './rows.ts'

export { MANIFEST_FILE, readManifest, scanRoot } from './discovery.ts'
export type { DiscoveredPack, PackManifest } from './discovery.ts'
export { RULES_DIR, SKILLS_DIR } from './rows.ts'

/** Precedence a root's packs carry when another provider publishes the same id. */
const DEFAULT_ROOT_RANK = 300

/** Byte cap for one rule file. */
const DEFAULT_MAX_RULE_BYTES = 65_536

/** Category a pack that names none is grouped under. */
const DEFAULT_CATEGORY = 'general'

/** Version reported for a pack that names none. */
const DEFAULT_VERSION = '0.0.0'

/** One scanned directory holding pack directories. */
export interface PackRoot {
  /** Directory path; a leading `~` expands to the current home directory. */
  path: string
  /** Precedence for this root's packs; lower wins a duplicate id. */
  rank?: number
}

/** Local pack provider configuration. */
export interface Config {
  /** Scanned directories in precedence order; earlier roots win an equal-rank duplicate id. */
  roots: PackRoot[]
  /** Provider name in `ctx.packs`; distinct per mounted instance. */
  providerName?: string
  /** Byte cap for one rule file; a larger file is skipped rather than truncated. */
  maxRuleBytes?: number
}

export const name = 'pack-local'
export const inject = ['packs']

export const Config: Schema<Config> = z.object({
  roots: z.array(z.object({
    path: z.string().required(),
    rank: z.number(),
  })).default([]),
  providerName: z.string().min(1).default('local'),
  maxRuleBytes: z.number().step(1).min(1).default(DEFAULT_MAX_RULE_BYTES),
})

/**
 * Expand a leading `~` and resolve against the process working directory.
 * @param path - configured root path.
 * @returns the absolute path to scan.
 */
export function resolveRoot(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return isAbsolute(path) ? path : resolve(path)
}

/** Configuration after schemastery applied every declared default. */
interface ResolvedConfig extends Config {
  providerName: string
  maxRuleBytes: number
}

/** What one candidate needs to load its rows later. */
interface Locator {
  readonly directory: string
}

/**
 * Project one discovered pack into a registry candidate.
 * @param pack - the discovered directory and its manifest.
 * @param providerName - the provider publishing it.
 * @param rank - the root's precedence.
 * @param order - display position when the manifest names none.
 * @returns the candidate the registry merges.
 */
function candidateOf(pack: DiscoveredPack, providerName: string, rank: number, order: number): PackCandidate {
  const { manifest } = pack
  return {
    id: PackId(pack.id),
    name: manifest.name ?? pack.id,
    description: manifest.description ?? '',
    category: manifest.category ?? DEFAULT_CATEGORY,
    version: manifest.version ?? DEFAULT_VERSION,
    order: manifest.order ?? order,
    ...manifest.icon === undefined ? {} : { icon: manifest.icon },
    provider: providerName,
    resourceBase: { kind: 'directory', path: pack.directory },
    rank,
    locator: { directory: pack.directory } satisfies Locator,
  }
}

/**
 * Register the local pack provider for the mounting composition.
 * @param ctx - the mounting context.
 * @param config - roots to scan, provider name, and the rule-file byte cap.
 */
export function apply(ctx: Context, config: Config): void {
  const { providerName, maxRuleBytes } = config as ResolvedConfig
  const roots = config.roots.map(root => ({
    path: resolveRoot(root.path),
    rank: root.rank ?? DEFAULT_ROOT_RANK,
  }))

  const provider: PackProvider = {
    name: providerName,
    async list(): Promise<PackProviderObservation> {
      const candidates: PackCandidate[] = []
      let complete = true
      let order = 0
      for (const root of roots) {
        const scan = await scanRoot(root.path, isPackId)
        if (!scan.complete) {
          complete = false
          ctx.logger.warn(`pack root "${root.path}" could not be scanned`)
        }
        for (const pack of scan.packs) {
          candidates.push(candidateOf(pack, providerName, root.rank, order))
          order += 1
        }
      }
      return { candidates, complete }
    },
    async get(candidate: PackCandidate): Promise<PackDefinition | undefined> {
      const { directory } = candidate.locator as Locator
      const { rank: _rank, locator: _locator, ...summary } = candidate
      return { ...summary, rows: await buildRows(directory, candidate.id, maxRuleBytes) }
    },
  }

  // `registerProvider` is itself effect-based on the calling context, so the
  // provider unregisters when this plugin unloads; wrapping it would only add
  // a second disposal layer over the same registration.
  ctx.packs.registerProvider(() => provider)
}
