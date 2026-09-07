# Packs

English | [中文](pack.zh.md)

The [pack capability family](../../packages/pack) gives a project its own way of working. A **pack** is a named bundle of agent behavior — instruction rules, skills, hooks, commands, subagents, and MCP servers — that a user turns on for a workspace; every session started in that workspace is then composed with the pack's contributions. Packs bind to a workspace rather than to a session, which is what distinguishes them from [agent presets](core.md#ctxagentpresets--agentpresets): a preset answers "what kind of agent is this session", a pack answers "how does this project work".

Source: [`packages/pack/pack/src/index.ts`](../../packages/pack/pack/src/index.ts).

## Roles

The family follows the [capability-seam](../capability-seams.md) split. Only the first role exists today; the rest are designed and named here so the vocabulary is stable, and each is marked with its state.

| Role | Owner | State |
|---|---|---|
| Service Definition | [`dsh-pack`](../../packages/pack/pack) (`ctx.packs`) | shipped |
| Service Provider | [`dsh-pack-local`](../../packages/pack/pack-local) for directories on this host; a licensed remote provider remains open | local shipped |
| Consumer | [`dsh-pack-rules`](../../packages/pack/pack-rules) realizes a pack's rules; a pack's skills reuse [`dsh-skill-filesystem`](../../packages/skill/skill-filesystem) | shipped |
| Binding | [`dsh-pack-binding`](../../packages/pack/pack-binding) (`ctx.packBindings`) | shipped |
| Mounting | [`dsh-pack-mount`](../../packages/pack/pack-mount) (`ctx.packMount`), called from the session entry point's agent setup | shipped |

Every role the family needs to run is in place. What is missing is a surface: turning a pack on for a project is an API call today, with no Remote and no browser page behind it.

## Binding identity

A binding keys on the directory's canonical `fs.realpath`, not on a `WorkspaceId`. `dsh-workspace` ships only with the browser application, while a session can be opened in that directory by every profile, so a path key is what lets a headless or SDK run compose from the same packs as the browser. It also survives a project being removed from the workspace list and added again, which mints a new workspace id.

## Where a mount happens

`ApiSessionAgentController.composeAgent()` builds the `setup` callback an unpublished agent runs, and calls `ctx.get('packMount')?.mount(agentCtx, cwd)` after the agent preset mounts. Three consequences follow: packs layer over the preset, the composition is fixed before the agent's first request, and a deployment that mounts no pack rows composes exactly as it did before — the optional read answers `undefined` and nothing else changes.

## A pack on disk

The local provider defines the only layout that exists today. Every part is optional except the manifest, whose presence is what marks a directory as a pack.

```text
viet-truyen/
  pack.yml     display text only; the id is the directory name
  rules/*.md   one prompt section each, in filename order
  skills/      an ordinary skill directory
```

`pack.yml` carries display text and nothing else — the id comes from the directory name, exactly as `preset.yml` works, so a locally authored pack cannot claim an id it did not write. A manifest that cannot be parsed degrades to empty metadata rather than hiding the pack, because presentation is not a capability.

Each contribution kind reuses a plugin that already exists rather than adding a second way to deliver it: rules become one `dsh-pack-rules` row carrying their text, and skills become one `dsh-skill-filesystem` row scoped to the pack by `providerName` and `includeDefaultRoots: false`. A pack's `hooks/`, `commands/`, `agents/`, and `mcp.json` have no loader yet.

## Why a pack's rows are Cordis rows

A pack's contents are heterogeneous — rules are prompt sections, skills are catalog entries, hooks are shell processes, MCP servers are external connections — and the harness already has one representation that covers all of them: a Cordis plugin row. `PackRow` therefore mirrors an agent preset's `agent.cordis.yml` entry, so a loader that reads a pack's `hooks/`, `commands/`, or `mcp.json` emits rows the existing mount machinery already understands, and no new mounting mechanism is needed.

This works because agent and tool events are scope-dispatched. A row mounted inside a scoped composition receives only the agents in that scope: `scopeTarget` admits an untagged listener globally, admits a listener tagged with a key on the dispatched agent's scope chain, and excludes every other tag ([`packages/core/scope/src/index.ts`](../../packages/core/scope/src/index.ts)). Events travel up the scope chain and never down, so an enclosing composition observes the agents composed under it while a sibling composition sees nothing. `packages/preset/agent-presets/tests/listener-scope.spec.ts` is the executed proof, for both `agent/pre-step` and `tools/pre-execute`.

## Identity

A pack id is kebab-case (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), matching the skill-name grammar because an id also becomes a directory name. `PackId` is [branded](../../packages/util/brand/README.md): it crosses the registry, the binding store, and every wire surface as an opaque key, and must not be interchangeable with a workspace id or a skill name.

## The registry

`ctx.packs` merges provider catalogs into one sorted listing and loads the winning pack's rows on demand. It has no scope layering — a pack binds to a workspace, not to an agent scope, so the registration set is flat and one cached observation serves every reader.

Duplicate ids resolve by `rank`, then provider registration order, then the provider's own listing order. Only the winner reaches the catalog, so a deployment can shadow a bundled pack with its own without removing the bundled source.

Discovery completeness is reported rather than hidden. `snapshot()` returns `complete: false` when any provider failed or reported incomplete discovery, and such an observation is never cached, so a consumer can distinguish an authoritative empty catalog from an unreachable source and retain its own last-good listing.

## Entitlement is a provider concern

The registry has no entitlement concept, deliberately. A provider lists what the current installation may see, so an unentitled pack never enters a catalog and its rows never reach a consumer that could leak them. Filtering in a consumer instead would mean the pack's contents had already crossed into a surface that was not allowed to have them.

This bounds what packaging can protect: a pack whose files sit on the user's own machine is readable by that user regardless of what a catalog reports. Content that must stay unreadable belongs to a remote provider that returns it against a token.

## Package reference

- [`dsh-pack`](../../packages/pack/pack/README.md) — the registry: registration, precedence, caching, failure vocabulary, and the provider contract.
- [`dsh-pack-local`](../../packages/pack/pack-local/README.md) — the local provider: the manifest, the directory layout, root precedence, and row generation.
- [`dsh-pack-rules`](../../packages/pack/pack-rules/README.md) — the rules Consumer: section naming, ordering, and prompt placement.
- [`dsh-pack-binding`](../../packages/pack/pack-binding/README.md) — the binding store: path canon, read and write semantics, and durability.
- [`dsh-pack-mount`](../../packages/pack/pack-mount/README.md) — the mounting step: row namespacing, the scope guarantee, and the activation audit.
