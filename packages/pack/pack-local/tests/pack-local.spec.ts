import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import PackRegistry from '@deepseek-ai/dsh-pack'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as PackLocal from '@deepseek-ai/dsh-pack-local'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** A scratch root that is cleaned up after the test. */
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pack-local-'))
  roots.push(root)
  return root
}

/** Write one pack directory; `files` maps a pack-relative path to its content. */
async function writePack(root: string, id: string, files: Record<string, string>): Promise<string> {
  const directory = join(root, id)
  for (const [path, content] of Object.entries(files)) {
    const full = join(directory, path)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, content)
  }
  return directory
}

/** A registry with the local provider mounted over `root`. */
async function harness(root: string, config: Partial<PackLocal.Config> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(PackRegistry)
  await ctx.plugin(PackLocal, { roots: [{ path: root }], ...config })
  return ctx
}

describe('resolving a configured root', () => {
  it('expands a bare home marker', () => {
    expect(PackLocal.resolveRoot('~')).toBe(homedir())
  })

  it('expands a home-relative path', () => {
    expect(PackLocal.resolveRoot('~/packs')).toBe(join(homedir(), 'packs'))
  })

  it('keeps an absolute path unchanged', () => {
    expect(PackLocal.resolveRoot(join(tmpdir(), 'packs'))).toBe(join(tmpdir(), 'packs'))
  })

  it('resolves a relative path against the working directory', () => {
    expect(PackLocal.resolveRoot('packs')).toBe(resolve('packs'))
  })
})

describe('discovering local packs', () => {
  it('lists a directory holding a manifest', async () => {
    const root = await makeRoot()
    await writePack(root, 'viet-truyen', {
      'pack.yml': 'name: Viết truyện\ndescription: Long-form fiction.\ncategory: writing\nversion: 1.2.0\norder: 5\n',
    })
    const ctx = await harness(root)

    await expect(ctx.packs.list()).resolves.toEqual([expect.objectContaining({
      id: 'viet-truyen',
      name: 'Viết truyện',
      description: 'Long-form fiction.',
      category: 'writing',
      version: '1.2.0',
      order: 5,
      provider: 'local',
    })])
  })

  it('ignores a directory with no manifest', async () => {
    const root = await makeRoot()
    await writePack(root, 'not-a-pack', { 'notes.md': 'just a folder' })
    const ctx = await harness(root)

    await expect(ctx.packs.list()).resolves.toEqual([])
  })

  it('ignores a directory whose name is not a valid pack id', async () => {
    const root = await makeRoot()
    await writePack(root, 'Not An Id', { 'pack.yml': 'name: Rejected\n' })
    const ctx = await harness(root)

    await expect(ctx.packs.list()).resolves.toEqual([])
  })

  it('treats a missing root as an authoritative empty catalog', async () => {
    const root = await makeRoot()
    const ctx = await harness(join(root, 'never-created'))

    await expect(ctx.packs.snapshot()).resolves.toEqual({ packs: [], complete: true })
  })

  it('falls back to the directory name and defaults when the manifest is empty', async () => {
    const root = await makeRoot()
    await writePack(root, 'bare', { 'pack.yml': '' })
    const ctx = await harness(root)

    await expect(ctx.packs.list()).resolves.toEqual([expect.objectContaining({
      id: 'bare',
      name: 'bare',
      description: '',
      category: 'general',
      version: '0.0.0',
    })])
  })

  it('keeps a pack whose manifest cannot be parsed', async () => {
    const root = await makeRoot()
    await writePack(root, 'broken-yaml', { 'pack.yml': 'name: [unclosed\n' })
    const ctx = await harness(root)

    await expect(ctx.packs.list()).resolves.toEqual([expect.objectContaining({ id: 'broken-yaml', name: 'broken-yaml' })])
  })

  it('ignores manifest fields of the wrong type', async () => {
    const root = await makeRoot()
    await writePack(root, 'wrong-types', { 'pack.yml': 'name: 42\norder: not-a-number\ndescription: "   "\n' })
    const ctx = await harness(root)

    await expect(ctx.packs.list()).resolves.toEqual([expect.objectContaining({
      id: 'wrong-types',
      name: 'wrong-types',
      description: '',
      order: 0,
    })])
  })

  it('keeps a pack whose manifest is a scalar rather than a mapping', async () => {
    const root = await makeRoot()
    await writePack(root, 'scalar', { 'pack.yml': 'just a string\n' })
    const ctx = await harness(root)

    await expect(ctx.packs.list()).resolves.toEqual([expect.objectContaining({ id: 'scalar', name: 'scalar' })])
  })

  it('reports an unreadable root as incomplete discovery', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'a-file'), 'not a directory')
    const ctx = new Context()
    await ctx.plugin(PackRegistry)
    await ctx.plugin(PackLocal, { roots: [{ path: join(root, 'a-file') }] })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

    const snapshot = await ctx.packs.snapshot()

    expect(snapshot.complete).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not be scanned'))
  })

  it('gives an earlier root precedence over a later one at equal rank', async () => {
    const first = await makeRoot()
    const second = await makeRoot()
    await writePack(first, 'shared', { 'pack.yml': 'name: from first\n' })
    await writePack(second, 'shared', { 'pack.yml': 'name: from second\n' })
    const ctx = new Context()
    await ctx.plugin(PackRegistry)
    await ctx.plugin(PackLocal, { roots: [{ path: first }, { path: second }] })

    await expect(ctx.packs.list()).resolves.toEqual([expect.objectContaining({ name: 'from first' })])
  })

  it('lets a later root win with an explicit lower rank', async () => {
    const first = await makeRoot()
    const second = await makeRoot()
    await writePack(first, 'shared', { 'pack.yml': 'name: from first\n' })
    await writePack(second, 'shared', { 'pack.yml': 'name: from second\n' })
    const ctx = new Context()
    await ctx.plugin(PackRegistry)
    await ctx.plugin(PackLocal, { roots: [{ path: first }, { path: second, rank: 10 }] })

    await expect(ctx.packs.list()).resolves.toEqual([expect.objectContaining({ name: 'from second' })])
  })

  it('serves two mounted instances under distinct provider names', async () => {
    const first = await makeRoot()
    const second = await makeRoot()
    await writePack(first, 'alpha', { 'pack.yml': 'name: Alpha\n' })
    await writePack(second, 'beta', { 'pack.yml': 'name: Beta\n' })
    const ctx = new Context()
    await ctx.plugin(PackRegistry)
    await ctx.plugin(PackLocal, { roots: [{ path: first }], providerName: 'bundled' })
    await ctx.plugin(PackLocal, { roots: [{ path: second }], providerName: 'user' })

    const listed = await ctx.packs.list()
    expect(listed.map(pack => [pack.id, pack.provider])).toEqual([['alpha', 'bundled'], ['beta', 'user']])
  })

  it('unregisters its provider when the row unloads', async () => {
    const root = await makeRoot()
    await writePack(root, 'alpha', { 'pack.yml': 'name: Alpha\n' })
    const ctx = new Context()
    await ctx.plugin(PackRegistry)
    const fiber = await ctx.plugin(PackLocal, { roots: [{ path: root }] })
    expect(await ctx.packs.list()).toHaveLength(1)

    await fiber.dispose()

    await expect(ctx.packs.list()).resolves.toEqual([])
  })
})

describe('building a pack\'s composition rows', () => {
  it('turns rule files into one pack-rules row, in filename order', async () => {
    const root = await makeRoot()
    await writePack(root, 'writing', {
      'pack.yml': 'name: Writing\n',
      'rules/2-length.md': 'Chapters run 2000-3000 words.',
      'rules/1-voice.md': 'Write in close third person.',
    })
    const ctx = await harness(root)

    const definition = await ctx.packs.get('writing')

    expect(definition?.rows).toEqual([{
      id: 'rules',
      name: '@deepseek-ai/dsh-pack-rules',
      config: {
        sections: [
          { name: 'pack:writing:1-voice', text: 'Write in close third person.' },
          { name: 'pack:writing:2-length', text: 'Chapters run 2000-3000 words.' },
        ],
      },
    }])
  })

  it('points a skill-filesystem row at the pack\'s own skills directory', async () => {
    const root = await makeRoot()
    const directory = await writePack(root, 'writing', {
      'pack.yml': 'name: Writing\n',
      'skills/outline/SKILL.md': '---\nname: outline\ndescription: Outline a story.\n---\nBody.',
    })
    const ctx = await harness(root)

    const definition = await ctx.packs.get('writing')

    expect(definition?.rows).toEqual([{
      id: 'skills',
      name: '@deepseek-ai/dsh-skill-filesystem',
      config: {
        providerName: 'pack:writing',
        includeDefaultRoots: false,
        customSkillDirs: [join(directory, 'skills')],
      },
    }])
  })

  it('emits rules before skills when a pack ships both', async () => {
    const root = await makeRoot()
    await writePack(root, 'both', {
      'pack.yml': 'name: Both\n',
      'rules/voice.md': 'Rule body.',
      'skills/outline/SKILL.md': 'Body.',
    })
    const ctx = await harness(root)

    const definition = await ctx.packs.get('both')

    expect(definition?.rows.map(row => row.id)).toEqual(['rules', 'skills'])
  })

  it('produces no rows for a pack that ships neither', async () => {
    const root = await makeRoot()
    await writePack(root, 'empty', { 'pack.yml': 'name: Empty\n' })
    const ctx = await harness(root)

    await expect(ctx.packs.get('empty')).resolves.toEqual(expect.objectContaining({ rows: [] }))
  })

  it('ignores non-markdown files and subdirectories under rules', async () => {
    const root = await makeRoot()
    await writePack(root, 'mixed', {
      'pack.yml': 'name: Mixed\n',
      'rules/voice.md': 'Kept.',
      'rules/notes.txt': 'Dropped.',
      'rules/nested/deep.md': 'Dropped.',
    })
    const ctx = await harness(root)

    const definition = await ctx.packs.get('mixed')

    expect(definition?.rows[0]?.config).toEqual({ sections: [{ name: 'pack:mixed:voice', text: 'Kept.' }] })
  })

  it('ignores an empty skills directory', async () => {
    const root = await makeRoot()
    const directory = await writePack(root, 'no-skills', { 'pack.yml': 'name: None\n' })
    await mkdir(join(directory, 'skills'), { recursive: true })
    const ctx = await harness(root)

    await expect(ctx.packs.get('no-skills')).resolves.toEqual(expect.objectContaining({ rows: [] }))
  })

  it('skips a rule file over the byte cap rather than truncating it', async () => {
    const root = await makeRoot()
    await writePack(root, 'long', {
      'pack.yml': 'name: Long\n',
      'rules/short.md': 'ok',
      'rules/huge.md': 'x'.repeat(200),
    })
    const ctx = await harness(root, { maxRuleBytes: 100 })

    const definition = await ctx.packs.get('long')

    expect(definition?.rows[0]?.config).toEqual({ sections: [{ name: 'pack:long:short', text: 'ok' }] })
  })

  it('carries the pack directory as the resource base for relative assets', async () => {
    const root = await makeRoot()
    const directory = await writePack(root, 'iconed', { 'pack.yml': 'name: Iconed\nicon: assets/icon.svg\n' })
    const ctx = await harness(root)

    await expect(ctx.packs.get('iconed')).resolves.toEqual(expect.objectContaining({
      icon: 'assets/icon.svg',
      resourceBase: { kind: 'directory', path: directory },
    }))
  })

  it('does not leak the provider locator into the loaded definition', async () => {
    const root = await makeRoot()
    await writePack(root, 'alpha', { 'pack.yml': 'name: Alpha\n' })
    const ctx = await harness(root)

    const definition = await ctx.packs.get('alpha')

    expect(definition).not.toHaveProperty('locator')
    expect(definition).not.toHaveProperty('rank')
  })
})
