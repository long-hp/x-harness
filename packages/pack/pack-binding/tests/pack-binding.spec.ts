import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { PackId } from '@deepseek-ai/dsh-pack'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import PackBindings from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** A scratch directory that is cleaned up after the test. */
async function makeDir(name = 'project'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pack-binding-'))
  roots.push(root)
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  return directory
}

/** Boot the real storage/domain/service composition over a memory backend. */
async function harness(pool = new MemoryMediaPool()): Promise<{ ctx: Context; pool: MemoryMediaPool }> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PackBindings)
  return { ctx, pool }
}

describe('reading bindings', () => {
  it('answers empty for a directory nothing was bound to', async () => {
    const { ctx } = await harness()
    const directory = await makeDir()

    await expect(ctx.packBindings.for(directory)).resolves.toEqual([])
  })

  it('answers empty for a directory that does not exist', async () => {
    const { ctx } = await harness()
    const directory = await makeDir()

    await expect(ctx.packBindings.for(join(directory, 'never-created'))).resolves.toEqual([])
  })

  it('returns what was bound', async () => {
    const { ctx } = await harness()
    const directory = await makeDir()

    await ctx.packBindings.set(directory, [PackId('viet-truyen'), PackId('marketing')])

    await expect(ctx.packBindings.for(directory)).resolves.toEqual(['viet-truyen', 'marketing'])
  })

  it('reads through a different spelling of the same directory', async () => {
    const { ctx } = await harness()
    const directory = await makeDir()
    await ctx.packBindings.set(directory, [PackId('viet-truyen')])

    const roundabout = join(directory, '..', 'project')

    await expect(ctx.packBindings.for(roundabout)).resolves.toEqual(['viet-truyen'])
  })

  it('reads through a symlink to the bound directory', async () => {
    const { ctx } = await harness()
    const directory = await makeDir()
    const link = join(directory, '..', 'link')
    await symlink(directory, link, 'dir')
    await ctx.packBindings.set(directory, [PackId('viet-truyen')])

    await expect(ctx.packBindings.for(link)).resolves.toEqual(['viet-truyen'])
  })

  it('accepts a path relative to the process working directory', async () => {
    const { ctx } = await harness()

    await expect(ctx.packBindings.for('.')).resolves.toEqual([])
  })
})

describe('writing bindings', () => {
  it('replaces the whole list rather than merging', async () => {
    const { ctx } = await harness()
    const directory = await makeDir()
    await ctx.packBindings.set(directory, [PackId('alpha'), PackId('beta')])

    await ctx.packBindings.set(directory, [PackId('gamma')])

    await expect(ctx.packBindings.for(directory)).resolves.toEqual(['gamma'])
  })

  it('collapses duplicates while keeping order', async () => {
    const { ctx } = await harness()
    const directory = await makeDir()

    const stored = await ctx.packBindings.set(directory, [PackId('beta'), PackId('alpha'), PackId('beta')])

    expect(stored).toEqual(['beta', 'alpha'])
    await expect(ctx.packBindings.for(directory)).resolves.toEqual(['beta', 'alpha'])
  })

  it('removes the record when the list empties', async () => {
    const { ctx } = await harness()
    const directory = await makeDir()
    await ctx.packBindings.set(directory, [PackId('alpha')])

    await expect(ctx.packBindings.set(directory, [])).resolves.toEqual([])

    expect(ctx.packBindings.list()).toEqual([])
  })

  it('accepts unbinding a directory that was never bound', async () => {
    const { ctx } = await harness()
    const directory = await makeDir()

    await expect(ctx.packBindings.set(directory, [])).resolves.toEqual([])
  })

  it('refuses to bind a directory that does not exist', async () => {
    const { ctx } = await harness()
    const directory = await makeDir()

    await expect(ctx.packBindings.set(join(directory, 'never-created'), [PackId('alpha')]))
      .rejects.toThrow(/ENOENT/)
  })

  it('keeps two directories independent', async () => {
    const { ctx } = await harness()
    const first = await makeDir('first')
    const second = await makeDir('second')

    await ctx.packBindings.set(first, [PackId('alpha')])
    await ctx.packBindings.set(second, [PackId('beta')])

    await expect(ctx.packBindings.for(first)).resolves.toEqual(['alpha'])
    await expect(ctx.packBindings.for(second)).resolves.toEqual(['beta'])
  })
})

describe('listing and durability', () => {
  it('lists every bound directory', async () => {
    const { ctx } = await harness()
    const first = await makeDir('first')
    const second = await makeDir('second')
    await ctx.packBindings.set(first, [PackId('alpha')])
    await ctx.packBindings.set(second, [PackId('beta')])

    expect(ctx.packBindings.list().map(binding => binding.packIds)).toEqual([['alpha'], ['beta']])
  })

  it('survives a restart of the composition', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    const directory = await makeDir()
    await first.ctx.packBindings.set(directory, [PackId('viet-truyen')])
    await first.ctx.fiber.dispose()

    const second = await harness(pool)

    await expect(second.ctx.packBindings.for(directory)).resolves.toEqual(['viet-truyen'])
  })

  it('closes its domain when the service unloads, freeing the name for a reopen', async () => {
    const pool = new MemoryMediaPool()
    const { ctx } = await harness(pool)
    await ctx.fiber.dispose()

    await expect(harness(pool)).resolves.toBeDefined()
  })
})
