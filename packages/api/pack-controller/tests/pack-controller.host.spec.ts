import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import PackRegistry, { PackId } from '@deepseek-ai/dsh-pack'
import type { PackCandidate, PackDefinition } from '@deepseek-ai/dsh-pack'
import PackBindings from '@deepseek-ai/dsh-pack-binding'
import { remoteErrorOf, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import PackController from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** A scratch directory that is cleaned up after the test. */
async function makeDir(name = 'project'): Promise<string> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), 'dsh-pack-controller-')))
  roots.push(root)
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  return directory
}

/** One catalog candidate served from memory. */
function memoryPack(id: string, overrides: Partial<PackCandidate> = {}): PackCandidate {
  return {
    id: PackId(id),
    name: `${id} pack`,
    description: '',
    category: 'general',
    version: '1.0.0',
    order: 0,
    provider: 'memory',
    // The host path a provider may attach; it must not reach the wire view.
    resourceBase: { kind: 'directory', path: '/host/only' },
    rank: 100,
    locator: undefined,
    ...overrides,
  }
}

/** Boot the real registry, binding store, and controller over a memory backend. */
async function harness(candidates: PackCandidate[] = [], complete = true): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PackRegistry)
  ctx.packs.registerProvider(() => ({
    name: 'memory',
    list: () => Promise.resolve({ candidates, complete }),
    get: (candidate): Promise<PackDefinition> => {
      const { rank: _rank, locator: _locator, ...summary } = candidate
      return Promise.resolve({ ...summary, rows: [] })
    },
  }))
  await ctx.plugin(PackBindings)
  const dispose = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: () => dispose },
    contexts: { configureHost: () => dispose },
  } as never)
  await ctx.plugin(PackController)
  return ctx
}

describe('the pack Remote namespace a plugin gallery calls', () => {
  it('publishes the pack namespace from its own service key', async () => {
    const ctx = await harness()
    expect(ctx.packController.typertRemote.serviceKey).toBe('packController')
    expect(ctx.packController.typertRemote.namespace).toBe('pack')
    expect(remoteMethods(ctx.packController)).toEqual([
      { method: 'catalog', invocation: { kind: 'direct' } },
      { method: 'bindings', invocation: { kind: 'direct' } },
      { method: 'bind', invocation: { kind: 'direct' } },
      { method: 'boundDirectories', invocation: { kind: 'direct' } },
    ])
  })

  it('serves display text without the provider\'s host path', async () => {
    const ctx = await harness([memoryPack('viet-truyen', { icon: 'icon.svg' })])

    const catalog = await ctx.packController.catalog(new AbortController().signal)

    expect(catalog).toEqual({
      complete: true,
      packs: [{
        id: 'viet-truyen',
        name: 'viet-truyen pack',
        description: '',
        category: 'general',
        version: '1.0.0',
        order: 0,
        icon: 'icon.svg',
        provider: 'memory',
      }],
    })
  })

  it('reports incomplete discovery so a surface can keep its last-good listing', async () => {
    const ctx = await harness([memoryPack('viet-truyen')], false)

    await expect(ctx.packController.catalog(new AbortController().signal))
      .resolves.toMatchObject({ complete: false })
  })

  it('binds a directory and reads the binding back', async () => {
    const ctx = await harness([memoryPack('viet-truyen')])
    const directory = await makeDir()

    const bound = await ctx.packController.bind(directory, ['viet-truyen'])

    expect(bound).toEqual({ directory, packs: ['viet-truyen'] })
    await expect(ctx.packController.bindings(directory))
      .resolves.toEqual({ directory, packs: ['viet-truyen'] })
  })

  it('replaces rather than merges, and an empty list unbinds', async () => {
    const ctx = await harness()
    const directory = await makeDir()
    await ctx.packController.bind(directory, ['viet-truyen', 'ke-toan'])

    await expect(ctx.packController.bind(directory, ['ke-toan']))
      .resolves.toEqual({ directory, packs: ['ke-toan'] })
    await expect(ctx.packController.bind(directory, []))
      .resolves.toEqual({ directory, packs: [] })
    expect(ctx.packController.boundDirectories()).toEqual({ bindings: [] })
  })

  it('answers the caller\'s own spelling of the directory, not the stored key', async () => {
    const ctx = await harness()
    const directory = await makeDir()
    const spelled = join(directory, '..', 'project')
    await ctx.packController.bind(spelled, ['viet-truyen'])

    // The caller gets its own path back so a page keyed by what the user typed
    // does not have to re-key itself on every response.
    await expect(ctx.packController.bindings(spelled))
      .resolves.toEqual({ directory: spelled, packs: ['viet-truyen'] })
    // The management listing is keyed by the canonical path instead.
    expect(ctx.packController.boundDirectories())
      .toEqual({ bindings: [{ directory, packs: ['viet-truyen'] }] })
  })

  it('reads a directory that is gone as bound to nothing', async () => {
    const ctx = await harness()

    await expect(ctx.packController.bindings('/does/not/exist'))
      .resolves.toEqual({ directory: '/does/not/exist', packs: [] })
  })

  it('refuses a write to a directory that cannot be resolved', async () => {
    const ctx = await harness()

    const failure = await ctx.packController.bind('/does/not/exist', ['viet-truyen'])
      .catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'pack/unresolvable-directory',
      details: { directory: '/does/not/exist' },
    })
  })

  it('reports a store refusal that carries no Error', async () => {
    const ctx = await harness()
    const directory = await makeDir()
    // A same-process service may reject with a bare value; the mapping must
    // still produce a readable diagnostic rather than "[object Object]".
    vi.spyOn(PackBindings.prototype, 'set').mockRejectedValueOnce('the store is locked')

    const failure = await ctx.packController.bind(directory, ['viet-truyen'])
      .catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'pack/unresolvable-directory',
      message: `cannot bind packs to "${directory}": the store is locked`,
    })
  })

  it('stores an id no provider serves, so an uninstalled pack can return', async () => {
    const ctx = await harness()
    const directory = await makeDir()

    await expect(ctx.packController.bind(directory, ['not-installed']))
      .resolves.toEqual({ directory, packs: ['not-installed'] })
  })

  it('rejects a malformed request before it reaches the store', async () => {
    const ctx = await harness()
    const directory = await makeDir()
    const calls: Array<() => unknown> = [
      () => ctx.packController.bindings(''),
      () => ctx.packController.bind('', ['viet-truyen']),
      () => ctx.packController.bind(directory, ['']),
      () => ctx.packController.bind(directory, undefined as unknown as string[]),
    ]
    for (const call of calls) {
      const failure = await Promise.resolve().then(call).catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
    }
  })
})
