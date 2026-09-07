// A preset row whose only contribution is event listeners — the shape a hook
// bridge or an MCP client takes when a composition mounts it. Each admitted
// dispatch appends `<tag>:<event>:<session>` to a well-known global array, so
// a spec can read which agents reached this registration.
//
// Import-free on purpose — the Loader resolves entry modules through Node's
// ESM resolver, which cannot see this workspace's TypeScript sources, and a
// fixture therefore cannot import a test helper for the sink either.
export const name = 'listen'

/** The array the spec reads; keyed globally because the fixture cannot import one. */
export const SINK_KEY = Symbol.for('dsh.agent-presets.listener-sink')

export function apply(ctx, config) {
  const record = (event, agent) => {
    const sink = globalThis[SINK_KEY] ??= []
    sink.push(`${config.tag}:${event}:${agent === undefined ? 'no-agent' : agent.session.id}`)
  }
  ctx.on('agent/session-start', ({ agent }) => record('session-start', agent))
  ctx.on('agent/pre-step', (payload, next) => {
    record('pre-step', payload.agent)
    return next()
  })
  ctx.on('tools/pre-execute', (exec, next) => {
    record('pre-execute', exec.agent)
    return next()
  })
}
