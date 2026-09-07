/**
 * Local pack discovery: which directories under a configured root are packs,
 * and what each one publishes about itself.
 *
 * A pack directory is any direct child of a root that holds a `pack.yml`. The
 * id is the directory name, never a field inside the file, so a locally
 * authored pack cannot claim the id of one it did not write — the same rule
 * `preset.yml` follows.
 *
 * @module @deepseek-ai/dsh-pack-local/discovery
 */

import { readdir, readFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

/** The display-metadata file that marks a directory as a pack. */
export const MANIFEST_FILE = 'pack.yml'

/** Display text a pack publishes about itself; every field is optional. */
export interface PackManifest {
  /** Human-facing name; falls back to the pack id when absent. */
  readonly name?: string
  /** One sentence on what the pack is for. */
  readonly description?: string
  /** Grouping label a gallery sorts sections by. */
  readonly category?: string
  /** Version string shown for support. */
  readonly version?: string
  /** Position among packs; lower comes first. */
  readonly order?: number
  /** Icon path relative to the pack directory. */
  readonly icon?: string
}

/** One discovered pack directory and the metadata it published. */
export interface DiscoveredPack {
  /** Kebab-case id, taken from the directory name. */
  readonly id: string
  /** Absolute path of the pack directory. */
  readonly directory: string
  /** Whatever the manifest published, after field-by-field validation. */
  readonly manifest: PackManifest
}

/** A non-empty trimmed string, or undefined for anything else. */
function text(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed === '' ? undefined : trimmed
}

/** A finite number, or undefined for anything else. */
function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Copy one optional field onto a manifest only when the value survived validation. */
function field<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value }
}

/**
 * Read one pack directory's manifest.
 *
 * An unparsable or wrongly-shaped file yields empty metadata rather than
 * hiding the pack, because presentation is not a capability: a pack whose
 * display text is broken still carries usable rules and skills, and hiding it
 * would leave a directory the user can see but no surface can name. An absent
 * file is different — it means the directory is not a pack at all.
 * @param directory - the pack directory.
 * @returns the published metadata, or `undefined` when the directory holds no manifest.
 */
export async function readManifest(directory: string): Promise<PackManifest | undefined> {
  let raw: string
  try {
    raw = await readFile(join(directory, MANIFEST_FILE), 'utf8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object') return {}
  const fields = parsed as Record<string, unknown>
  return {
    ...field('name', text(fields.name)),
    ...field('description', text(fields.description)),
    ...field('category', text(fields.category)),
    ...field('version', text(fields.version)),
    ...field('order', finite(fields.order)),
    ...field('icon', text(fields.icon)),
  }
}

/**
 * Scan one root for pack directories.
 *
 * A root that does not exist yields nothing and still counts as a completed
 * scan: a deployment may configure a personal pack directory before creating
 * it. Any other read failure leaves the scan incomplete, so an unreadable root
 * never reads as "this root holds no packs".
 * @param root - absolute path of the directory holding pack directories.
 * @param isId - the id grammar check a candidate directory name must pass.
 * @returns discovered packs in directory-name order, and whether the scan completed.
 */
export async function scanRoot(
  root: string,
  isId: (id: string) => boolean,
): Promise<{ packs: DiscoveredPack[]; complete: boolean }> {
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    return { packs: [], complete: (error as NodeJS.ErrnoException).code === 'ENOENT' }
  }
  const names = entries
    .filter(entry => entry.isDirectory() && isId(entry.name))
    .map(entry => entry.name)
    .sort()
  const packs: DiscoveredPack[] = []
  for (const id of names) {
    const directory = join(root, id)
    const manifest = await readManifest(directory)
    if (manifest === undefined) continue
    packs.push({ id, directory, manifest })
  }
  return { packs, complete: true }
}
