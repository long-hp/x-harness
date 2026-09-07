/**
 * Row generation: turn one pack directory's contents into the Cordis rows a
 * bound session mounts.
 *
 * Each contribution kind reuses a plugin that already exists. Rules become one
 * `dsh-pack-rules` row carrying their text, because a remote provider has no
 * filesystem the mounting process could read a path from. Skills become one
 * `dsh-skill-filesystem` row pointed at the pack's own `skills/` directory,
 * with default roots off and a pack-qualified provider name so two packs
 * mounted in one scope cannot collide in the skill registry. Hooks become one
 * `dsh-hooks-claude-code` row pointed at the pack's `hooks/hooks.json`.
 *
 * Hooks are the one kind that travels as a path rather than as content: a hook
 * is a command line, and the commands a pack ships run its own scripts through
 * `${CLAUDE_PLUGIN_ROOT}`. Those scripts have to exist on the host that runs
 * them, so a hook-bearing pack is filesystem-bound whatever its provider does
 * with the rest of its contents.
 *
 * @module @deepseek-ai/dsh-pack-local/rows
 */

import { access, readdir, readFile } from 'node:fs/promises'
import { constants, type Dirent } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { PackRow } from '@deepseek-ai/dsh-pack'

/** Directory inside a pack holding its instruction rules. */
export const RULES_DIR = 'rules'

/** Directory inside a pack holding its skills. */
export const SKILLS_DIR = 'skills'

/** Directory inside a pack holding its hook configuration. */
export const HOOKS_DIR = 'hooks'

/** Claude Code hook configuration file inside {@link HOOKS_DIR}. */
export const HOOKS_FILE = 'hooks.json'

/** Row id carrying a pack's rules. */
const RULES_ROW = 'rules'

/** Row id carrying a pack's skills. */
const SKILLS_ROW = 'skills'

/** Row id carrying a pack's hooks. */
const HOOKS_ROW = 'hooks'

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
 * The readable path to a pack's hook configuration.
 *
 * Absence is the ordinary case — most packs ship no hooks — so a pack without
 * the file contributes no hook row rather than one the bridge would reject at
 * load. A file that exists but cannot be parsed still produces a row: the
 * bridge owns that diagnostic and reports it against the path.
 * @param directory - the pack directory.
 * @returns the configuration path, or undefined when the pack ships none.
 */
export async function hooksConfigPath(directory: string): Promise<string | undefined> {
  const path = join(directory, HOOKS_DIR, HOOKS_FILE)
  try {
    await access(path, constants.R_OK)
    return path
  } catch {
    return undefined
  }
}

/**
 * Build the composition rows one pack directory contributes.
 *
 * A pack that ships no rules, skills, or hooks produces no rows; it remains a
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
  const hooks = await hooksConfigPath(directory)
  if (hooks !== undefined) {
    rows.push({
      id: HOOKS_ROW,
      name: '@deepseek-ai/dsh-hooks-claude-code',
      // `projectDir` stays unset so `CLAUDE_PROJECT_DIR` defaults per run to the
      // session's own working directory — for a pack, the bound project is the
      // directory the session opened in, not the pack's own directory.
      config: { configPath: hooks, pluginRoot: directory },
    })
  }
  return rows
}
