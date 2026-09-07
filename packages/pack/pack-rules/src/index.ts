/**
 * Pack rules Consumer: realize one pack's instruction rules as prompt sections
 * in the scope that mounts this row.
 *
 * A pack's rules are carried as text rather than as file paths, because a pack
 * may come from a remote provider that has no filesystem the mounting process
 * can read. The provider reads whatever format it owns and emits one row of
 * this plugin; everything below that is ordinary prompt-section registration.
 *
 * @module @deepseek-ai/dsh-pack-rules
 */

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'

/** One instruction rule contributed by a pack. */
export interface PackRuleSection {
  /**
   * Prompt-section name, unique within the mounting scope. A duplicate throws
   * at the section registry, which fails this row's mount rather than dropping
   * a rule the user believes is active; a pack provider therefore qualifies the
   * name with the pack id it came from.
   */
  name: string
  /** Rule body placed in the system prompt; empty text drops the section at render. */
  text: string
  /** Position among prompt sections; omission uses the central `PACK_RULES` slot, after the deployment persona and before plan policy. */
  order?: number
}

/** Plugin config: the rules this pack contributes to its mounting scope. */
export interface Config {
  /** Rules in the order the pack's provider read them. */
  sections: PackRuleSection[]
}

export const name = 'pack-rules'
export const inject = ['systemPrompt']

export const Config: Schema<Config> = z.object({
  sections: z.array(z.object({
    name: z.string().required(),
    text: z.string().required(),
    order: z.number(),
  })).default([]),
})

/**
 * Register each configured rule as a prompt section in the calling scope.
 * @param ctx - the mounting context; a pack row mounts inside one agent's scope,
 *   so the sections it registers reach that agent alone.
 * @param config - the rules this pack contributes.
 */
export function apply(ctx: Context, config: Config): void {
  const fallbackOrder = ctx.systemPrompt.getSectionOrder('PACK_RULES')
  for (const section of config.sections) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: section.name,
      order: section.order ?? fallbackOrder,
      text: section.text,
    }), 'pack-rules.section()')
  }
}
