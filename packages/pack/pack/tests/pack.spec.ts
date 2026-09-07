import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import PackRegistry, {
  isPackId,
  PackId,
  type PackCandidate,
  type PackDefinition,
  type PackLookupOptions,
  type PackProvider,
  type PackProviderObservation,
} from '@deepseek-ai/dsh-pack'

function candidate(provider: string, id: string, overrides: Partial<PackCandidate> = {}): PackCandidate {
  return {
    id: PackId(id),
    name: `${id} pack`,
    description: `${id} description`,
    category: 'general',
    version: '1.0.0',
    order: 0,
    provider,
    rank: 100,
    locator: { rows: [{ id: 'row', name: `./${id}.js` }] },
    ...overrides,
  }
}

class MemoryProvider implements PackProvider {
  listCalls = 0

  constructor(
    readonly name: string,
    private candidates: readonly PackCandidate[] | PackProviderObservation,
  ) {}

  list(_options: PackLookupOptions): Promise<readonly PackCandidate[] | PackProviderObservation> {
    this.listCalls += 1
    return Promise.resolve(this.candidates)
  }

  get(entry: PackCandidate): Promise<PackDefinition | undefined> {
    const locator = entry.locator as { rows: PackDefinition['rows'] }
    return Promise.resolve({ ...entry, rows: locator.rows })
  }

  replace(candidates: readonly PackCandidate[] | PackProviderObservation): void {
    this.candidates = candidates
  }
}

/** A registry on its own context, plus the disposer for every mounted provider. */
async function registryWith(...providers: PackProvider[]): Promise<{ ctx: Context; packs: PackRegistry; dispose: () => void }> {
  const ctx = new Context()
  await ctx.plugin(PackRegistry)
  const disposers = providers.map(provider => ctx.packs.registerProvider(() => provider))
  return { ctx, packs: ctx.packs, dispose: () => { for (const undo of disposers) undo() } }
}

describe('pack id grammar', () => {
  it('accepts kebab-case and rejects everything else', async () => {
    expect(isPackId('viet-truyen')).toBe(true)
    expect(isPackId('a1')).toBe(true)
    expect(isPackId('Viet-Truyen')).toBe(false)
    expect(isPackId('viet_truyen')).toBe(false)
    expect(isPackId('-leading')).toBe(false)
    expect(isPackId('')).toBe(false)
  })

  it('brands a string without changing it', async () => {
    expect(PackId('viet-truyen')).toBe('viet-truyen')
  })
})

describe('provider registration', () => {
  it('lists the candidates a registered provider serves', async () => {
    const { packs } = await registryWith(new MemoryProvider('memory', [candidate('memory', 'alpha')]))

    await expect(packs.list()).resolves.toEqual([expect.objectContaining({ id: 'alpha' })])
  })

  it('refuses a second provider under a registered name', async () => {
    const { ctx } = await registryWith(new MemoryProvider('memory', []))

    expect(() => ctx.packs.registerProvider(() => new MemoryProvider('memory', [])))
      .toThrow('pack provider "memory" is already registered')
  })

  it('propagates a factory failure and aborts that registration lifecycle', async () => {
    const ctx = new Context()
    await ctx.plugin(PackRegistry)
    let observed: AbortSignal | undefined

    expect(() => ctx.packs.registerProvider((control) => {
      observed = control.signal
      throw new Error('factory failed')
    })).toThrow('factory failed')
    expect(observed?.aborted).toBe(true)
  })

  it('drops a provider and its catalog when its registration disposes', async () => {
    const { packs, dispose } = await registryWith(new MemoryProvider('memory', [candidate('memory', 'alpha')]))
    await packs.list()

    dispose()

    await expect(packs.list()).resolves.toEqual([])
  })

  it('aborts a disposed registration signal', async () => {
    const ctx = new Context()
    await ctx.plugin(PackRegistry)
    let signal: AbortSignal | undefined
    const undo = ctx.packs.registerProvider((control) => {
      signal = control.signal
      return new MemoryProvider('memory', [])
    })

    undo()

    expect(signal?.aborted).toBe(true)
  })
})

describe('plugin lifetime', () => {
  it('drops a provider mounted by a plugin when that plugin\'s fiber disposes', async () => {
    const ctx = new Context()
    await ctx.plugin(PackRegistry)
    const changes = vi.fn()
    ctx.on('packs/change', changes)
    const contributor = await ctx.plugin({
      name: 'pack-contributor',
      inject: ['packs'],
      apply(inner: Context) {
        inner.packs.registerProvider(() => new MemoryProvider('memory', [candidate('memory', 'alpha')]))
      },
    })
    await expect(ctx.packs.list()).resolves.toEqual([expect.objectContaining({ id: 'alpha' })])
    const notified = changes.mock.calls.length

    await contributor.dispose()

    expect(changes.mock.calls.length).toBeGreaterThan(notified)
    await expect(ctx.packs.list()).resolves.toEqual([])
  })
})

describe('catalog merging', () => {
  it('sorts by order then id', async () => {
    const { packs } = await registryWith(new MemoryProvider('memory', [
      candidate('memory', 'zulu', { order: 1 }),
      candidate('memory', 'bravo', { order: 2 }),
      candidate('memory', 'delta', { order: 2 }),
      candidate('memory', 'alpha', { order: 2 }),
    ]))

    await expect(packs.list()).resolves.toEqual([
      expect.objectContaining({ id: 'zulu' }),
      expect.objectContaining({ id: 'alpha' }),
      expect.objectContaining({ id: 'bravo' }),
      expect.objectContaining({ id: 'delta' }),
    ])
  })

  it('gives a duplicate id to the lower rank', async () => {
    const { packs } = await registryWith(
      new MemoryProvider('low', [candidate('low', 'alpha', { rank: 500, name: 'loser' })]),
      new MemoryProvider('high', [candidate('high', 'alpha', { rank: 100, name: 'winner' })]),
    )

    await expect(packs.list()).resolves.toEqual([expect.objectContaining({ name: 'winner' })])
  })

  it('breaks an equal rank by provider registration order', async () => {
    const { packs } = await registryWith(
      new MemoryProvider('first', [candidate('first', 'alpha', { name: 'winner' })]),
      new MemoryProvider('second', [candidate('second', 'alpha', { name: 'loser' })]),
    )

    await expect(packs.list()).resolves.toEqual([expect.objectContaining({ name: 'winner' })])
  })

  it('breaks an equal rank inside one provider by listing order', async () => {
    const { packs } = await registryWith(new MemoryProvider('memory', [
      candidate('memory', 'alpha', { name: 'winner' }),
      candidate('memory', 'alpha', { name: 'loser' }),
    ]))

    await expect(packs.list()).resolves.toEqual([expect.objectContaining({ name: 'winner' })])
  })

  it('accepts an explicit observation and reports it incomplete', async () => {
    const { packs } = await registryWith(new MemoryProvider('memory', {
      candidates: [candidate('memory', 'alpha')],
      complete: false,
    }))

    await expect(packs.snapshot()).resolves.toEqual({
      packs: [expect.objectContaining({ id: 'alpha' })],
      complete: false,
    })
  })

  it('rejects an observation that is neither an array nor a complete pair', async () => {
    const { packs } = await registryWith(new MemoryProvider('memory', { candidates: [] } as unknown as PackProviderObservation))

    await expect(packs.list()).rejects.toThrow('must return an array or { candidates, complete } observation')
  })

  it('keeps serving other providers when one fails', async () => {
    const failing: PackProvider = {
      name: 'failing',
      list: () => Promise.reject(new Error('provider exploded')),
      get: () => Promise.resolve(undefined),
    }
    const { ctx, packs } = await registryWith(failing, new MemoryProvider('memory', [candidate('memory', 'alpha')]))
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

    const snapshot = await packs.snapshot()

    expect(snapshot.packs).toEqual([expect.objectContaining({ id: 'alpha' })])
    expect(snapshot.complete).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pack provider "failing" skipped: provider exploded'))
  })

  it('reports a non-Error provider rejection as text', async () => {
    const failing: PackProvider = {
      name: 'failing',
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the point is a non-Error rejection
      list: () => Promise.reject('plain string'),
      get: () => Promise.resolve(undefined),
    }
    const { ctx, packs } = await registryWith(failing)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

    await packs.list()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('plain string'))
  })
})

describe('candidate validation', () => {
  it.each([
    ['a non-kebab id', { id: PackId('Bad Id') }, 'is not kebab-case'],
    ['an empty name', { name: '' }, 'has an empty name'],
    ['an empty category', { category: '' }, 'has an empty category'],
    ['an empty version', { version: '' }, 'has an empty version'],
    ['a non-finite order', { order: Number.NaN }, 'has a non-finite order'],
    ['a non-finite rank', { rank: Number.POSITIVE_INFINITY }, 'has a non-finite rank'],
    ['a mismatched provider claim', { provider: 'someone-else' }, 'claims provider "someone-else"'],
  ])('rejects %s', async (_case, overrides, reason) => {
    const { packs } = await registryWith(new MemoryProvider('memory', [candidate('memory', 'alpha', overrides)]))

    await expect(packs.list()).rejects.toThrow(reason)
  })
})

describe('optional metadata', () => {
  it('lists a pack that publishes no description', async () => {
    const { packs } = await registryWith(new MemoryProvider('memory', [candidate('memory', 'alpha', { description: '' })]))

    await expect(packs.list()).resolves.toEqual([expect.objectContaining({ id: 'alpha', description: '' })])
  })
})

describe('catalog caching', () => {
  it('answers a repeated listing without asking providers again', async () => {
    const provider = new MemoryProvider('memory', [candidate('memory', 'alpha')])
    const { packs } = await registryWith(provider)

    await packs.list()
    await packs.list()

    expect(provider.listCalls).toBe(1)
  })

  it('never caches an incomplete observation', async () => {
    const provider = new MemoryProvider('memory', { candidates: [], complete: false })
    const { packs } = await registryWith(provider)

    await packs.list()
    await packs.list()

    expect(provider.listCalls).toBe(2)
  })

  it('refetches after a provider invalidates itself', async () => {
    const ctx = new Context()
    await ctx.plugin(PackRegistry)
    const provider = new MemoryProvider('memory', [candidate('memory', 'alpha')])
    let control: { invalidate: () => void } | undefined
    ctx.packs.registerProvider((given) => {
      control = given
      return provider
    })
    await ctx.packs.list()

    provider.replace([candidate('memory', 'beta')])
    control?.invalidate()

    await expect(ctx.packs.list()).resolves.toEqual([expect.objectContaining({ id: 'beta' })])
    expect(provider.listCalls).toBe(2)
  })

  it('ignores an invalidate from a registration that already disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(PackRegistry)
    const provider = new MemoryProvider('memory', [candidate('memory', 'alpha')])
    let control: { invalidate: () => void } | undefined
    const undo = ctx.packs.registerProvider((given) => {
      control = given
      return provider
    })
    await ctx.packs.list()
    undo()
    await ctx.packs.list()
    const before = provider.listCalls

    control?.invalidate()
    await ctx.packs.list()

    expect(provider.listCalls).toBe(before)
  })
})

describe('change notification', () => {
  it('notifies listeners when the registry changes', async () => {
    const ctx = new Context()
    await ctx.plugin(PackRegistry)
    const seen = vi.fn()
    ctx.on('packs/change', seen)

    ctx.packs.registerProvider(() => new MemoryProvider('memory', []))

    expect(seen).toHaveBeenCalled()
  })

  it('contains a listener that throws', async () => {
    const ctx = new Context()
    await ctx.plugin(PackRegistry)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ctx.on('packs/change', () => { throw new Error('listener exploded') })

    expect(() => ctx.packs.registerProvider(() => new MemoryProvider('memory', []))).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('packs/change listener threw: listener exploded'))
  })

  it('contains a listener that rejects', async () => {
    const ctx = new Context()
    await ctx.plugin(PackRegistry)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    // oxlint-disable-next-line typescript/no-misused-promises -- deliberate rejection proves notification containment
    ctx.on('packs/change', () => Promise.reject(new Error('listener rejected')))

    ctx.packs.registerProvider(() => new MemoryProvider('memory', []))
    await Promise.resolve()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('packs/change listener rejected: listener rejected'))
  })
})

describe('loading a pack', () => {
  it('returns the winning provider\'s composition rows', async () => {
    const { packs } = await registryWith(new MemoryProvider('memory', [candidate('memory', 'alpha')]))

    await expect(packs.get('alpha')).resolves.toEqual(expect.objectContaining({
      id: 'alpha',
      rows: [{ id: 'row', name: './alpha.js' }],
    }))
  })

  it('refuses an id that is not kebab-case before touching a provider', async () => {
    const { packs } = await registryWith(new MemoryProvider('memory', []))

    await expect(packs.get('Not An Id')).rejects.toThrow('is not kebab-case')
  })

  it('answers undefined for an id no provider serves', async () => {
    const { packs } = await registryWith(new MemoryProvider('memory', [candidate('memory', 'alpha')]))

    await expect(packs.get('beta')).resolves.toBeUndefined()
  })

  it('answers undefined when the provider can no longer load the pack', async () => {
    const provider: PackProvider = {
      name: 'memory',
      list: () => Promise.resolve([candidate('memory', 'alpha')]),
      get: () => Promise.resolve(undefined),
    }
    const { packs } = await registryWith(provider)

    await expect(packs.get('alpha')).resolves.toBeUndefined()
  })

  it('rejects a definition whose id does not match the request', async () => {
    const provider: PackProvider = {
      name: 'memory',
      list: () => Promise.resolve([candidate('memory', 'alpha')]),
      get: () => Promise.resolve({ ...candidate('memory', 'beta'), rows: [] }),
    }
    const { packs } = await registryWith(provider)

    await expect(packs.get('alpha')).rejects.toThrow('answered id "beta" for requested pack "alpha"')
  })
})

describe('cancellation', () => {
  it('refuses a listing whose signal already aborted', async () => {
    const { packs } = await registryWith(new MemoryProvider('memory', []))

    await expect(packs.list({ signal: AbortSignal.abort(new Error('caller left')) }))
      .rejects.toThrow('caller left')
  })

  it('refuses a load whose signal already aborted', async () => {
    const { packs } = await registryWith(new MemoryProvider('memory', []))

    await expect(packs.get('alpha', { signal: AbortSignal.abort(new Error('caller left')) }))
      .rejects.toThrow('caller left')
  })

  it('settles at an abort rather than waiting for an unresponsive provider', async () => {
    const hanging: PackProvider = {
      name: 'hanging',
      list: () => new Promise(() => {}),
      get: () => Promise.resolve(undefined),
    }
    const { packs } = await registryWith(hanging)
    const controller = new AbortController()

    const listing = packs.list({ signal: controller.signal })
    controller.abort(new Error('caller left'))

    await expect(listing).rejects.toThrow('caller left')
  })

  it('normalizes a non-Error abort reason', async () => {
    const hanging: PackProvider = {
      name: 'hanging',
      list: () => new Promise(() => {}),
      get: () => Promise.resolve(undefined),
    }
    const { packs } = await registryWith(hanging)
    const controller = new AbortController()

    const listing = packs.list({ signal: controller.signal })
    controller.abort('plain reason')

    await expect(listing).rejects.toThrow('plain reason')
  })
})
