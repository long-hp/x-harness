import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { makeBridgeHarness, textResponse, type BridgeHarness } from './harness.ts'

/**
 * A workspace directory's packs reach an ACP session as they reach a browser
 * session. The binding is keyed by path precisely so an editor driving the
 * harness over ACP composes the same way as the application.
 */
describe('ACP session pack composition', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  it('composes the requested workspace directory\'s packs', async () => {
    const mounted: string[] = []
    harness = await makeBridgeHarness({ script: [textResponse('done')] })
    harness.ctx.provide('packMount', {
      mount: (_agentCtx: unknown, cwd: string) => { mounted.push(cwd); return Promise.resolve() },
    } as never)

    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    expect(mounted).toEqual([process.cwd()])
  })

  it('composes without packs when the deployment publishes no mount', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('done')] })

    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    expect(created.sessionId).toBeTruthy()
  })
})
