/**
 * Row generation: turn one pack directory's contents into the Cordis rows a
 * bound session mounts.
 *
 * Each contribution kind reuses a plugin that already exists. Rules become one
 * `dsh-pack-rules` row carrying their text, because a remote provider has no
 * filesystem the mounting process could read a path from. Skills become one
 * `dsh-skill-filesystem` row pointed at the pack's own `skills/` directory,
 * with default roots off and a pack-qualified provider name so two packs
 * mounted in one scope cannot collide in the skill registry.
 *
 * @module @deepseek-ai/dsh-pack-local/rows
 */

import { readdir, readFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { PackRow } from '@deepseek-ai/dsh-pack'

/** Directory inside a pack holding its instruction rules. */
export const RULES_DIR = 'rules'

/** Directory inside a pack holding its skills. */
export const SKILLS_DIR = 'skills'

/** Row id carrying a pack's rules. */
const RULES_ROW = 'rules'

/** Row id carrying a pack's skills. */
const SKILLS_ROW = 'skills'

/** One rule file read from a pack. */
interface PackRule {
  /** Prompt-section name, qualified by the pack id so two packs cannot collide. */
  readonly name: string
  /** File body. */
  readonly text: string
}

/**
 * Read a pack's `rules/*.md` files in filename order.
 *
 * A rule file larger than the cap is skipped rather than truncated, because
 * half an instruction is worse guidance than none.
 * @param directory - the pack directory.
 * @param id - the pack id, used to qualify section names.
 * @param maxRuleBytes - byte cap for one rule file.
 * @returns the rules found, empty when the pack ships none.
 */
export async function readRules(directory: string, id: string, maxRuleBytes: number): Promise<PackRule[]> {
  const root = join(directory, RULES_DIR)
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const files = entries
    .filter(entry => entry.isFile() && extname(entry.name) === '.md')
    .map(entry => entry.name)
    .sort()
  const rules: PackRule[] = []
  for (const file of files) {
    let text: string
    try {
      text = await readFile(join(root, file), 'utf8')
    } catch {
      /* v8 ignore next -- a rule file listed by readdir can still vanish or lose
         readability before this read; only a race or a permission change reaches
         here, neither of which a test can stage without becoming flaky. */
      continue
    }
    if (Buffer.byteLength(text, 'utf8') > maxRuleBytes) continue
    rules.push({ name: `pack:${id}:${basename(file, '.md')}`, text })
  }
  return rules
}

/**
 * Whether a pack ships a non-empty skills directory.
 * @param directory - the pack directory.
 * @returns whether the directory holds at least one skill entry.
 */
export async function hasSkills(directory: string): Promise<boolean> {
  try {
    const entries = await readdir(join(directory, SKILLS_DIR))
    return entries.length > 0
  } catch {
    return false
  }
}

/**
 * Build the composition rows one pack directory contributes.
 *
 * A pack that ships neither rules nor skills produces no rows; it remains a
 * listable pack, because binding it is still a meaningful user action once it
 * gains contents.
 * @param directory - the pack directory.
 * @param id - the pack id.
 * @param maxRuleBytes - byte cap for one rule file.
 * @returns the rows, in mount order.
 */
export async function buildRows(directory: string, id: string, maxRuleBytes: number): Promise<PackRow[]> {
  const rows: PackRow[] = []
  const rules = await readRules(directory, id, maxRuleBytes)
  if (rules.length > 0) {
    rows.push({
      id: RULES_ROW,
      name: '@deepseek-ai/dsh-pack-rules',
      config: { sections: rules.map(rule => ({ name: rule.name, text: rule.text })) },
    })
  }
  if (await hasSkills(directory)) {
    rows.push({
      id: SKILLS_ROW,
      name: '@deepseek-ai/dsh-skill-filesystem',
      config: {
        providerName: `pack:${id}`,
        includeDefaultRoots: false,
        customSkillDirs: [join(directory, SKILLS_DIR)],
      },
    })
  }
  return rows
}
