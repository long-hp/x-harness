import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import PackRegistry, { PackId } from '@deepseek-ai/dsh-pack'
import type { PackCandidate, PackDefinition, PackRow } from '@deepseek-ai/dsh-pack'
import PackBindings from '@deepseek-ai/dsh-pack-binding'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import PackMount from '../src/index.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const ROW_HOOK = Symbol.for('dsh.pack-mount.row-hook')
const paths: string[] = []

afterEach(async () => {
  ;(globalThis as Record<symbol, unknown>)[ROW_HOOK] = undefined
  for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true })
})

/** A scratch directory that is cleaned up after the test. */
async function makeDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pack-composition-'))
  paths.push(root)
  return root
}

/** A one-row composition file beside the fixture plugins, so its relative row resolves. */
async function writeComposition(): Promise<string> {
  const file = join(FIXTURES, `app.${process.pid.toString()}.${String(paths.length)}.yml`)
  paths.push(file)
  await writeFile(file, '- id: mounter\n  name: ./plugins/mounts-packs.js\n')
  return file
}

/** One pack served from memory, carrying a tool row. */
function memoryPack(id: string, tool: string): PackCandidate {
  const rows: PackRow[] = [{ id: 'tool', name: './plugins/contribute.js', config: { tool } }]
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

describe('mounting from inside a composed row', () => {
  it('mounts a bound pack and reclaims the composed row\'s subtree slot', async () => {
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
      list: () => Promise.resolve([memoryPack('writing', 'writing-tool')]),
      get: (candidate): Promise<PackDefinition> => {
        const { rank: _rank, locator, ...summary } = candidate
        return Promise.resolve({ ...summary, rows: (locator as { rows: PackRow[] }).rows })
      },
    }))
    await ctx.plugin(PackBindings)
    await ctx.plugin(PackMount)

    const directory = await makeDir()
    await ctx.packBindings.set(directory, [PackId('writing')])
    const key: ScopeKey = { agent: 'composed' }
    let mounted: Promise<void> | undefined
    let rowEntry: { subtree?: unknown } | undefined
    ;(globalThis as Record<symbol, unknown>)[ROW_HOOK] = (rowCtx: Context) => {
      // The row's own context is a Loader entry, which is what the session
      // entry point hands the mount in a real application.
      rowEntry = rowCtx.fiber.entry
      mounted = ctx.packMount.mount(createScope(rowCtx, key).ctx, directory)
      return () => {}
    }

    const file = await writeComposition()
    await ctx.plugin(Include, { path: pathToFileURL(file).href })
    await mounted

    expect(ctx.tools.schemas(key as never).map(schema => schema.name)).toEqual(['writing-tool'])
    // The reclaimed slot: an agent's pack tree must not become the composed
    // row's subtree, or a Loader walk would report one agent's pack rows as
    // entries of the application itself.
    expect(rowEntry).toBeDefined()
    expect(rowEntry?.subtree).toBeUndefined()
  })
})
