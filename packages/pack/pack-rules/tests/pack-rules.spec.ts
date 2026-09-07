import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import { describe, expect, it } from 'vitest'
import * as PackRules from '@deepseek-ai/dsh-pack-rules'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: 'deployment identity' })
  return ctx
}

/** The section names and texts one scope assembles, in prompt order. */
async function sections(ctx: Context, scope?: ScopeKey): Promise<{ name: string; text: string }[]> {
  const assembly = await ctx.systemPrompt.assemble(scope === undefined ? {} : { scope })
  return assembly.sections.map(section => ({ name: section.name, text: section.text }))
}

describe('a pack rules row', () => {
  it('contributes each configured rule as a prompt section', async () => {
    const ctx = await harness()

    await ctx.plugin(PackRules, {
      sections: [
        { name: 'pack:viet-truyen:voice', text: 'Write in close third person.' },
        { name: 'pack:viet-truyen:length', text: 'Chapters run 2000-3000 words.' },
      ],
    })

    expect(await sections(ctx)).toEqual(expect.arrayContaining([
      { name: 'pack:viet-truyen:voice', text: 'Write in close third person.' },
      { name: 'pack:viet-truyen:length', text: 'Chapters run 2000-3000 words.' },
    ]))
  })

  it('places rules after the deployment persona by default', async () => {
    const ctx = await harness()

    await ctx.plugin(PackRules, { sections: [{ name: 'pack:p:rule', text: 'Rule body.' }] })

    const names = (await sections(ctx)).map(section => section.name)
    expect(names.indexOf('pack:p:rule')).toBeGreaterThan(names.indexOf('deployment:persona'))
  })

  it('honors an explicit order over the default slot', async () => {
    const ctx = await harness()

    await ctx.plugin(PackRules, {
      sections: [
        { name: 'pack:p:late', text: 'Late.', order: 200 },
        { name: 'pack:p:early', text: 'Early.', order: -200 },
      ],
    })

    const names = (await sections(ctx)).map(section => section.name)
    expect(names.indexOf('pack:p:early')).toBeLessThan(names.indexOf('deployment:persona'))
    expect(names.indexOf('pack:p:late')).toBeGreaterThan(names.indexOf('deployment:persona'))
  })

  it('reaches only the scope that mounted it', async () => {
    const ctx = await harness()
    const bound: ScopeKey = { agent: 'bound' }
    const other: ScopeKey = { agent: 'other' }
    createScope(ctx, other)

    await createScope(ctx, bound).ctx.plugin(PackRules, {
      sections: [{ name: 'pack:p:rule', text: 'Only for the bound workspace.' }],
    })

    expect((await sections(ctx, bound)).map(section => section.name)).toContain('pack:p:rule')
    expect((await sections(ctx, other)).map(section => section.name)).not.toContain('pack:p:rule')
    expect((await sections(ctx)).map(section => section.name)).not.toContain('pack:p:rule')
  })

  it('withdraws its sections when the row unloads', async () => {
    const ctx = await harness()
    const fiber = await ctx.plugin(PackRules, { sections: [{ name: 'pack:p:rule', text: 'Rule body.' }] })
    expect((await sections(ctx)).map(section => section.name)).toContain('pack:p:rule')

    await fiber.dispose()

    expect((await sections(ctx)).map(section => section.name)).not.toContain('pack:p:rule')
  })

  it('fails the mount when two rules claim one section name', async () => {
    const ctx = await harness()

    await expect(ctx.plugin(PackRules, {
      sections: [
        { name: 'pack:p:rule', text: 'First.' },
        { name: 'pack:p:rule', text: 'Second.' },
      ],
    })).rejects.toThrow(/pack:p:rule/)
  })

  it('mounts with no rules at all', async () => {
    const ctx = await harness()

    await ctx.plugin(PackRules, { sections: [] })

    expect((await sections(ctx)).map(section => section.name)).toContain('deployment:persona')
  })
})
