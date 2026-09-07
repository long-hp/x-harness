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

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpackbindings--packbindings"></a>

### `ctx.packBindings` — `PackBindings`

Durable `directory → packs` bindings over the domain data form. Reads are synchronous against the domain's in-memory table once a path is canonicalized; writes go through the domain's write chain.

```ts cordis-catalog
/**
 * Read the packs bound to one directory.
 *
 * A directory that cannot be resolved — deleted, or never created — holds no
 * bindings, so this answers empty rather than failing the caller that is
 * about to compose a session in it.
 * @param path - directory path in any spelling.
 * @returns the bound pack ids, empty when the directory has none.
 */
async for(path: string): Promise<readonly PackId[]>

/**
 * Replace the packs bound to one directory.
 *
 * An empty list removes the record rather than storing an empty one, so
 * "bound to nothing" and "never bound" are one state.
 * @param path - directory path in any spelling; it must exist.
 * @param packIds - the complete new binding list; duplicates collapse, order is kept.
 * @returns the stored binding list.
 * @throws when the directory does not exist or cannot be resolved.
 */
async set(path: string, packIds: readonly PackId[]): Promise<readonly PackId[]>

/**
 * Every directory that has packs bound, for a management surface.
 * @returns one entry per bound directory, in storage order.
 */
list(): readonly PackBinding[]
```

Source: [`packages/pack/pack-binding/src/index.ts`](../../packages/pack/pack-binding/src/index.ts)

<a id="ctxpackmount--packmount"></a>

### `ctx.packMount` — `PackMount`

Composes an agent from the packs bound to its workspace directory.

The service is optional in every composition: a deployment that mounts no pack rows simply never publishes it, and the session entry point that asks for it through `ctx.get('packMount')` gets `undefined` and composes as before.

```ts cordis-catalog
/**
 * Mount every pack bound to one directory under an agent's scope.
 *
 * A bound pack the catalog no longer serves is logged and skipped rather
 * than failing session creation: an uninstalled or unentitled pack must not
 * make a workspace unopenable. A pack whose rows fail to activate does fail
 * the mount, because a half-composed agent would run without the behavior
 * the user turned on and with no sign that anything was missing.
 * @param agentCtx - the agent's scope context, from the agent factory's `setup`.
 * @param cwd - the session's working directory.
 * @throws when `agentCtx` carries no scope, or when a bound pack's rows do not activate.
 */
async mount(agentCtx: Context, cwd: string): Promise<void>
```

Source: [`packages/pack/pack-mount/src/index.ts`](../../packages/pack/pack-mount/src/index.ts)

<a id="ctxpacks--packregistry"></a>

### `ctx.packs` — `PackRegistry`

Registry of pack providers. It merges provider catalogs into one sorted listing, resolves the winning provider for a duplicate id, and loads composition rows on demand. Registration is effect-based, so a provider unregisters when its plugin unloads.

```ts cordis-catalog
/**
 * Register a borrowed same-process provider synchronously during plugin
 * apply. Duplicate provider names throw; remote initialization and
 * entitlement resolution belong in `list()`. Fiber disposal unregisters the
 * provider and invalidates the cached catalog.
 * @param create - synchronous factory receiving this registration's lifecycle and invalidation control.
 * @returns the exact Cordis effect disposer that unregisters this provider.
 */
registerProvider(create: (control: PackProviderControl) => PackProvider): () => void

/**
 * List the winning pack summaries across every registered provider.
 * @param options - lookup options; `signal` cancels discovery.
 * @returns sorted summaries, dropping providers whose discovery failed.
 */
async list(options: PackLookupOptions = {}): Promise<readonly PackSummary[]>

/**
 * Observe the current catalog and whether every provider completed.
 * Incomplete observations are never cached, so a consumer may retain its
 * last-good listing and retry.
 * @param options - lookup options; `signal` cancels discovery.
 * @returns sorted summaries plus discovery completeness.
 */
async snapshot(options: PackLookupOptions = {}): Promise<PackCatalogSnapshot>

/**
 * Load one pack's composition rows from the provider that owns the winning
 * candidate for its id.
 * @param id - kebab-case pack id.
 * @param options - lookup options; `signal` cancels discovery and loading.
 * @returns the full definition, or `undefined` when no provider serves the id.
 * @throws TypeError when the id is not kebab-case, or when the winning
 *   provider answers with a definition for a different id.
 */
async get(id: string, options: PackLookupOptions = {}): Promise<PackDefinition | undefined>
```

Source: [`packages/pack/pack/src/index.ts`](../../packages/pack/pack/src/index.ts)

<a id="packs-events"></a>

### `packs/*` events

<a id="packschange--emit"></a>

#### `packs/change` — emit

A pack provider or a provider-backed catalog may have changed. This is an unfiltered invalidation notification; consumers refetch the catalog for their own lookup options. Listener failures are contained and cannot veto the registry mutation.

```ts cordis-catalog
/**
 * A pack provider or a provider-backed catalog may have changed. This is an
 * unfiltered invalidation notification; consumers refetch the catalog for
 * their own lookup options. Listener failures are contained and cannot veto
 * the registry mutation.
 * @mode emit
 */
'packs/change'(): void
```

Source: [`packages/pack/pack/src/index.ts`](../../packages/pack/pack/src/index.ts)
<!-- END GENERATED cordis-surface -->
