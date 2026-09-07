import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import PackRegistry, { PackId } from '@deepseek-ai/dsh-pack'
import type { PackCandidate, PackDefinition, PackRow } from '@deepseek-ai/dsh-pack'
import PackBindings from '@deepseek-ai/dsh-pack-binding'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import PackMount from '../src/index.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** A scratch directory that is cleaned up after the test. */
async function makeDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pack-mount-'))
  roots.push(root)
  return root
}

/** One pack served from memory, with the rows a provider would have produced. */
function memoryPack(id: string, rows: readonly PackRow[]): PackCandidate {
  return {
    id: PackId(id),
    name: `${id} pack`,
    description: '',
    category: 'general',
    version: '1.0.0',
    order: 0,
    provider: 'memory',
    rank: 100,
    locator: { rows },
  }
}

/** A tool row naming the fixture plugin, as a pack provider would emit it. */
function toolRow(rowId: string, tool: string): PackRow {
  return { id: rowId, name: './plugins/contribute.js', config: { tool } }
}

/** The registries, storage, pack catalog, and bindings one mount needs. */
async function harness(packs: readonly PackCandidate[]): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PackRegistry)
  ctx.packs.registerProvider(() => ({
    name: 'memory',
    list: () => Promise.resolve(packs),
    get: (candidate): Promise<PackDefinition> => {
      const { rank: _rank, locator, ...summary } = candidate
      return Promise.resolve({ ...summary, rows: (locator as { rows: PackRow[] }).rows })
    },
  }))
  await ctx.plugin(PackBindings)
  await ctx.plugin(PackMount)
  return ctx
}

/** Section names one scope assembles. */
async function sections(ctx: Context, scope?: ScopeKey): Promise<string[]> {
  const assembly = await ctx.systemPrompt.assemble(scope === undefined ? {} : { scope })
  return assembly.sections.map(section => section.name)
}

/** Tool names visible to one scope. */
function tools(ctx: Context, scope?: ScopeKey): string[] {
  return ctx.tools.schemas(scope as never).map(schema => schema.name).sort()
}

describe('mounting bound packs', () => {
  it('gives a bound directory its pack\'s tools and prompt sections', async () => {
    const ctx = await harness([memoryPack('writing', [toolRow('tool', 'writing-tool')])])
    const directory = await makeDir()
    await ctx.packBindings.set(directory, [PackId('writing')])
    const key: ScopeKey = { agent: 'bound' }
    const scope = createScope(ctx, key)

    await ctx.packMount.mount(scope.ctx, directory)

    expect(await sections(ctx, key)).toContain('pack:writing-tool')
    expect(tools(ctx, key)).toEqual(['writing-tool'])
  })

  it('leaves an unbound directory composing nothing', async () => {
    const ctx = await harness([memoryPack('writing', [toolRow('tool', 'writing-tool')])])
    const directory = await makeDir()
    const key: ScopeKey = { agent: 'unbound' }
    const scope = createScope(ctx, key)

    await ctx.packMount.mount(scope.ctx, directory)

    expect(tools(ctx, key)).toEqual([])
  })

  it('keeps one directory\'s packs out of another directory\'s sessions', async () => {
    const ctx = await harness([
      memoryPack('writing', [toolRow('tool', 'writing-tool')]),
      memoryPack('accounting', [toolRow('tool', 'accounting-tool')]),
    ])
    const first = await makeDir()
    const second = await makeDir()
    await ctx.packBindings.set(first, [PackId('writing')])
    await ctx.packBindings.set(second, [PackId('accounting')])
    const firstKey: ScopeKey = { agent: 'first' }
    const secondKey: ScopeKey = { agent: 'second' }

    await ctx.packMount.mount(createScope(ctx, firstKey).ctx, first)
    await ctx.packMount.mount(createScope(ctx, secondKey).ctx, second)

    expect(tools(ctx, firstKey)).toEqual(['writing-tool'])
    expect(tools(ctx, secondKey)).toEqual(['accounting-tool'])
    expect(tools(ctx)).toEqual([])
  })

  it('mounts several packs bound to one directory', async () => {
    const ctx = await harness([
      memoryPack('writing', [toolRow('tool', 'writing-tool')]),
      memoryPack('marketing', [toolRow('tool', 'marketing-tool')]),
    ])
    const directory = await makeDir()
    await ctx.packBindings.set(directory, [PackId('writing'), PackId('marketing')])
    const key: ScopeKey = { agent: 'both' }

    await ctx.packMount.mount(createScope(ctx, key).ctx, directory)

    expect(tools(ctx, key)).toEqual(['marketing-tool', 'writing-tool'])
  })

  it('keeps two packs from colliding on a shared row id', async () => {
    const ctx = await harness([
      memoryPack('writing', [toolRow('tool', 'writing-tool')]),
      memoryPack('marketing', [toolRow('tool', 'marketing-tool')]),
    ])
    const directory = await makeDir()
    await ctx.packBindings.set(directory, [PackId('writing'), PackId('marketing')])
    const key: ScopeKey = { agent: 'both' }

    await expect(ctx.packMount.mount(createScope(ctx, key).ctx, directory)).resolves.toBeUndefined()
  })

  it('withdraws a pack\'s registrations when the agent scope disposes', async () => {
    const ctx = await harness([memoryPack('writing', [toolRow('tool', 'writing-tool')])])
    const directory = await makeDir()
    await ctx.packBindings.set(directory, [PackId('writing')])
    const key: ScopeKey = { agent: 'transient' }
    const scope = createScope(ctx, key)
    await ctx.packMount.mount(scope.ctx, directory)
    expect(tools(ctx, key)).toEqual(['writing-tool'])

    await scope.dispose()

    expect(tools(ctx)).toEqual([])
  })
})

describe('failures', () => {
  it('refuses an unscoped context', async () => {
    const ctx = await harness([memoryPack('writing', [toolRow('tool', 'writing-tool')])])
    const directory = await makeDir()
    await ctx.packBindings.set(directory, [PackId('writing')])

    await expect(ctx.packMount.mount(ctx, directory)).rejects.toThrow(/unscoped context/)
  })

  it('skips a bound pack no provider serves and keeps the rest', async () => {
    const ctx = await harness([memoryPack('writing', [toolRow('tool', 'writing-tool')])])
    const directory = await makeDir()
    await ctx.packBindings.set(directory, [PackId('uninstalled'), PackId('writing')])
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const key: ScopeKey = { agent: 'partial' }

    await ctx.packMount.mount(createScope(ctx, key).ctx, directory)

    expect(tools(ctx, key)).toEqual(['writing-tool'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('bound pack "uninstalled" is not served'))
  })

  it('composes nothing when every bound pack is gone', async () => {
    const ctx = await harness([])
    const directory = await makeDir()
    await ctx.packBindings.set(directory, [PackId('uninstalled')])
    vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const key: ScopeKey = { agent: 'empty' }

    await ctx.packMount.mount(createScope(ctx, key).ctx, directory)

    expect(tools(ctx, key)).toEqual([])
  })

  it('composes nothing for a pack that carries no rows', async () => {
    const ctx = await harness([memoryPack('empty', [])])
    const directory = await makeDir()
    await ctx.packBindings.set(directory, [PackId('empty')])
    const key: ScopeKey = { agent: 'rowless' }

    await ctx.packMount.mount(createScope(ctx, key).ctx, directory)

    expect(tools(ctx, key)).toEqual([])
  })

  it('fails the mount when a pack row cannot start, leaving nothing behind', async () => {
    const ctx = await harness([memoryPack('broken', [
      toolRow('good', 'good-tool'),
      { id: 'bad', name: './plugins/throws.js' },
    ])])
    const directory = await makeDir()
    await ctx.packBindings.set(directory, [PackId('broken')])
    const key: ScopeKey = { agent: 'broken' }

    await expect(ctx.packMount.mount(createScope(ctx, key).ctx, directory)).rejects.toThrow()

    expect(tools(ctx, key)).toEqual([])
  })

  it('keeps a disabled row out of the composition without failing', async () => {
    const ctx = await harness([memoryPack('partly-off', [
      toolRow('on', 'on-tool'),
      { ...toolRow('off', 'off-tool'), disabled: true },
    ])])
    const directory = await makeDir()
    await ctx.packBindings.set(directory, [PackId('partly-off')])
    const key: ScopeKey = { agent: 'partly-off' }

    await ctx.packMount.mount(createScope(ctx, key).ctx, directory)

    expect(tools(ctx, key)).toEqual(['on-tool'])
  })
  it('fails the mount when a row waits for a service the composition never supplies', async () => {
    const ctx = await harness([memoryPack('waiting', [
      toolRow('good', 'good-tool'),
      { id: 'stuck', name: './plugins/needs-missing.js' },
    ])])
    const directory = await makeDir()
    await ctx.packBindings.set(directory, [PackId('waiting')])
    const key: ScopeKey = { agent: 'waiting' }

    await expect(ctx.packMount.mount(createScope(ctx, key).ctx, directory))
      .rejects.toThrow(/waiting for serviceThatDoesNotExist/)

    expect(tools(ctx, key)).toEqual([])
  })

  it('persists nothing when a row disposes itself, because a pack tree has no file', async () => {
    const ctx = await harness([memoryPack('vanishing', [
      { id: 'gone', name: './plugins/self-dispose.js' },
    ])])
    const directory = await makeDir()
    await ctx.packBindings.set(directory, [PackId('vanishing')])
    const key: ScopeKey = { agent: 'vanishing' }

    await ctx.packMount.mount(createScope(ctx, key).ctx, directory)
    await (globalThis as { __PACK_SELF_DISPOSED__?: Promise<unknown> }).__PACK_SELF_DISPOSED__
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(tools(ctx, key)).toEqual([])
  })
})
