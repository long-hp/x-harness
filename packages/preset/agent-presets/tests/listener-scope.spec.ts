import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry, { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import type { Config } from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-agent-presets/types'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const ROOTS = [{ path: join(FIXTURES, 'scope'), trust: 'user' as const }]
const ROSTER: Config = { default: 'quiet', roots: ROOTS, includeShippedRoot: false, includeUserRoot: false }

/** The sink `fixtures/plugins/listen.js` appends every admitted dispatch to. */
const SINK_KEY = Symbol.for('dsh.agent-presets.listener-sink')

/** Read and clear what the listener row observed. */
function drainSink(): string[] {
  const sink = (globalThis as Record<symbol, string[] | undefined>)[SINK_KEY] ?? []
  ;(globalThis as Record<symbol, string[] | undefined>)[SINK_KEY] = []
  return sink
}

/** A composition carrying the registries a preset contributes to, plus the preset roster. */
async function harness(): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, ROSTER)
  return ctx
}

async function agentOn(ctx: Context, id: string, presetId: string): Promise<Agent> {
  const handle = await ctx.agents.create({
    sessionId: SessionId(id),
    setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx, presetId),
  })
  return handle.agent
}

/** Dispatch the step-admission waterfall exactly as the loop driver does. */
async function preStep(ctx: Context, agent: Agent): Promise<void> {
  await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step: 1, signal: AbortSignal.abort() },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
}

let ctx: Context

beforeEach(async () => {
  drainSink()
  ctx = await harness()
})

afterEach(async () => {
  await ctx.fiber.dispose()
  drainSink()
})

describe('event listeners a preset row registers', () => {
  it('admits the composing agent and excludes an agent on another preset', async () => {
    const listening = await agentOn(ctx, 'sess-listening', 'listening')
    const quiet = await agentOn(ctx, 'sess-quiet', 'quiet')
    drainSink()

    await preStep(ctx, listening)
    await preStep(ctx, quiet)

    expect(drainSink()).toEqual(['listening:pre-step:sess-listening'])
  })

  it('admits every agent sharing the preset without leaking across presets', async () => {
    const first = await agentOn(ctx, 'sess-first', 'listening')
    const second = await agentOn(ctx, 'sess-second', 'listening')
    const outsider = await agentOn(ctx, 'sess-outsider', 'quiet')
    drainSink()

    await preStep(ctx, first)
    await preStep(ctx, second)
    await preStep(ctx, outsider)

    expect(drainSink()).toEqual([
      'listening:pre-step:sess-first',
      'listening:pre-step:sess-second',
    ])
  })

  it('scopes the tool-execution gate the same way', async () => {
    const listening = await agentOn(ctx, 'sess-listening', 'listening')
    const quiet = await agentOn(ctx, 'sess-quiet', 'quiet')
    drainSink()

    await ctx.tools.execute({
      callId: ToolCallId('call-listening'),
      name: 'listening-tool',
      arguments: {},
      agent: listening,
      signal: new AbortController().signal,
    })
    await ctx.tools.execute({
      callId: ToolCallId('call-quiet'),
      name: 'quiet-tool',
      arguments: {},
      agent: quiet,
      signal: new AbortController().signal,
    })

    expect(drainSink()).toEqual(['listening:pre-execute:sess-listening'])
  })

  it('stops admitting an agent once its composition unwinds', async () => {
    const handle = await ctx.agents.create({
      sessionId: SessionId('sess-transient'),
      setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx, 'listening'),
    })
    const survivor = await agentOn(ctx, 'sess-survivor', 'listening')
    drainSink()

    await handle.dispose()
    await preStep(ctx, survivor)

    expect(drainSink()).toEqual(['listening:pre-step:sess-survivor'])
  })
})
