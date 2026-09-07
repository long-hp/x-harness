import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as HooksClaudeCode from '@deepseek-ai/dsh-hooks-claude-code'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import PackRegistry, { PackId } from '@deepseek-ai/dsh-pack'
import * as PackLocal from '@deepseek-ai/dsh-pack-local'
import PackBindings from '@deepseek-ai/dsh-pack-binding'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import PackMount from '../src/index.ts'

/**
 * The claim this file proves: a pack that ships `hooks/hooks.json` applies its
 * hooks to sessions opened in a directory bound to it, and to no others.
 *
 * Only the model is mocked. The REAL `dsh-pack-local` provider reads a REAL
 * pack directory, the REAL `dsh-hooks-claude-code` bridge mounts through the
 * REAL Loader entry machinery, and a REAL shell runs the hook script. That is
 * what retires the bridge's documented "one config applies to the whole
 * process" limitation: it is a mounting choice, not an architectural bound.
 */

const paths: string[] = []

afterEach(async () => {
  for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true })
})

/** A scratch directory that is cleaned up after the test. */
async function makeDir(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  paths.push(root)
  return root
}

/**
 * Write a pack whose UserPromptSubmit hook prints `context` for the model. The
 * hook command reaches its script through `${CLAUDE_PLUGIN_ROOT}`, the token a
 * portable Claude Code pack uses, so the substitution is under test too.
 */
async function writeHookPack(root: string, id: string, context: string): Promise<void> {
  const directory = join(root, id)
  await mkdir(join(directory, 'hooks'), { recursive: true })
  await writeFile(join(directory, 'pack.yml'), `name: ${id} pack\nversion: 1.0.0\n`)
  const script = join(directory, 'hooks', 'emit.sh')
  await writeFile(script, `#!/usr/bin/env bash\ncat >/dev/null\nprintf '%s\\n' '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"${context}"}}'\n`)
  await chmod(script, 0o755)
  await writeFile(join(directory, 'hooks', 'hooks.json'), JSON.stringify({
    hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/hooks/emit.sh"' }] }] },
  }))
}

/** A harness carrying the pack seam over a real agent loop and a real shell. */
async function harness(packRoot: string, adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Loader)
  // Resolve the row's package name from source rather than from a built
  // `lib/`, the repo's rule for a test that must pass on a clean tree. The map
  // throws on any other specifier, so it also pins the exact module name
  // `dsh-pack-local` writes into a hook row.
  const modules = new Map<string, unknown>([['@deepseek-ai/dsh-hooks-claude-code', HooksClaudeCode]])
  ctx.loader.internal = {
    version: 'v2',
    import(specifier: string): Promise<unknown> {
      const module = modules.get(specifier)
      if (module === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
      return Promise.resolve(module)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000 })
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PackRegistry)
  await ctx.plugin(PackLocal, { roots: [{ path: packRoot }] })
  await ctx.plugin(PackBindings)
  await ctx.plugin(PackMount)
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** Create one agent whose session opens in `cwd`, composed from that directory's packs. */
async function openSession(ctx: Context, id: string, cwd: string): Promise<AgentHandle> {
  return ctx.agents.create({
    sessionId: SessionId(id),
    meta: { cwd },
    agentOptions: { provider: 'mock', model: 'mock' },
    setup: agentCtx => ctx.packMount.mount(agentCtx, cwd),
  })
}

/** Send one prompt and wait for the turn to finish. */
async function prompt(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

describe('a pack\'s hooks in a bound directory', () => {
  it('runs for a session in the bound directory and not for one outside it', async () => {
    const packRoot = await makeDir('dsh-pack-hooks-root-')
    await writeHookPack(packRoot, 'viet-truyen', 'pack hook context')

    const adapter = new MockAdapter([textResponse('bound'), textResponse('unbound')])
    const ctx = await harness(packRoot, adapter)

    const bound = await makeDir('dsh-pack-hooks-bound-')
    const unbound = await makeDir('dsh-pack-hooks-unbound-')
    await ctx.packBindings.set(bound, [PackId('viet-truyen')])

    const inBound = await openSession(ctx, 'bound-session', bound)
    await prompt(inBound.agent, 'first')
    const inUnbound = await openSession(ctx, 'unbound-session', unbound)
    await prompt(inUnbound.agent, 'second')

    // The hook's context reached the model for the bound directory only.
    expect(JSON.stringify(adapter.requests[0]!.messages)).toContain('pack hook context')
    expect(JSON.stringify(adapter.requests[1]!.messages)).not.toContain('pack hook context')

    // Only the bound session logs the hook pair, so the transcript records where
    // the pack acted rather than leaving it to be inferred from the prompt.
    const hookEvents = (agent: Agent): string[] => agent.session.snapshotEvents()
      .filter(event => event.type === 'hook/invoked' || event.type === 'hook/result')
      .map(event => event.type)
    expect(hookEvents(inBound.agent)).toEqual(['hook/invoked', 'hook/result'])
    expect(hookEvents(inUnbound.agent)).toEqual([])

    await inUnbound.dispose()
    await inBound.dispose()
  })

  it('gives two directories bound to different packs their own hooks', async () => {
    const packRoot = await makeDir('dsh-pack-hooks-root-')
    await writeHookPack(packRoot, 'viet-truyen', 'drafting context')
    await writeHookPack(packRoot, 'ke-toan', 'accounting context')

    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await harness(packRoot, adapter)

    const drafting = await makeDir('dsh-pack-hooks-drafting-')
    const accounting = await makeDir('dsh-pack-hooks-accounting-')
    await ctx.packBindings.set(drafting, [PackId('viet-truyen')])
    await ctx.packBindings.set(accounting, [PackId('ke-toan')])

    const inDrafting = await openSession(ctx, 'drafting-session', drafting)
    await prompt(inDrafting.agent, 'write')
    const inAccounting = await openSession(ctx, 'accounting-session', accounting)
    await prompt(inAccounting.agent, 'reconcile')

    const first = JSON.stringify(adapter.requests[0]!.messages)
    const second = JSON.stringify(adapter.requests[1]!.messages)
    expect(first).toContain('drafting context')
    expect(first).not.toContain('accounting context')
    expect(second).toContain('accounting context')
    expect(second).not.toContain('drafting context')

    await inAccounting.dispose()
    await inDrafting.dispose()
  })
})
