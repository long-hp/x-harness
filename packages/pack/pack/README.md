---
description: "The pack provider registry (ctx.packs): merge pack catalogs from any provider, resolve the winning pack for an id, and load its composition rows, for users and maintainers composing or extending pack sources."
kind: "package-reference"
---

# @deepseek-ai/dsh-pack

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-pack` is the registry every pack source contributes to: providers publish catalogs of installable behavior bundles — a pack's rules, skills, hooks, commands, subagents, and MCP servers — and this service merges those catalogs into one sorted listing, decides which provider wins a duplicate id, and loads the winning pack's composition rows on demand. Mount it in a composition that offers packs to users, together with at least one provider; without a provider it serves an empty catalog and costs nothing. It reads no files and knows no packaging format, so a provider is free to own a directory layout, an npm package, or a licensed remote service. Entitlement is a provider concern rather than a registry one: a provider lists only what the installation may see, so an unentitled pack never enters a catalog and its rows never reach a consumer.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the service, mount one or more providers beside it, and read the catalog through `ctx.packs`.

### When to choose it

Choose it when a deployment offers packs a user turns on for a project, and something must merge several pack sources behind one listing. Skip it when a deployment ships exactly one fixed set of plugins for every session — a composition file already says that, with no registry in between. This package is the Service Definition role alone: it registers no tools, serves no wire surface, and mounts nothing into an agent, so it does nothing observable until a provider and a consumer join it.

### Minimal configuration

The plugin takes no configuration; nothing here varies by deployment.

```yaml
- name: '@deepseek-ai/dsh-pack'
```

### Register a provider

A provider plugin registers synchronously during `apply()`. The factory receives a control whose `signal` aborts when the registration is disposed and whose `invalidate()` drops the cached catalog after the provider's own source changes.

```ts
import type { Context } from '@deepseek-ai/cordis'
import { PackId } from '@deepseek-ai/dsh-pack'

export const name = 'my-pack-source'
export const inject = ['packs']

export function apply(ctx: Context) {
  ctx.packs.registerProvider(control => ({
    name: 'my-pack-source',
    list: () => Promise.resolve([{
      id: PackId('viet-truyen'),
      name: 'Viết truyện',
      description: 'Long-form fiction drafting.',
      category: 'writing',
      version: '1.0.0',
      order: 1,
      provider: 'my-pack-source',
      rank: 100,
      locator: { /* whatever this provider needs to load the pack later */ },
    }]),
    get: candidate => Promise.resolve({ ...candidate, rows: [] }),
  }))
}
```

Registering a second provider under a name already registered throws, so a composition mounting one source twice fails at load rather than serving a silently doubled catalog.

### Read the catalog

`list()` answers the winning summaries, sorted by `order` then id. `snapshot()` answers the same listing plus whether every provider completed, so a surface can tell an authoritative empty catalog from a source that was temporarily unreachable. `get(id)` loads the winning pack's composition rows.

A pack id is kebab-case (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), because an id also becomes a directory name; `isPackId()` is the exported check, and `get()` refuses a non-matching id before touching a provider.

### Duplicate ids and precedence

Two providers may publish the same pack id. The lowest `rank` wins; equal ranks fall back to provider registration order, then to the order the provider itself listed them. Only the winner appears in the catalog and only the winner is loaded, so a deployment can shadow a bundled pack with its own without removing the bundled source.

### Failures and recovery

A provider whose `list()` rejects is logged and skipped: the catalog keeps every other provider's packs and reports `complete: false`. A provider returning something that is neither a candidate array nor a `{ candidates, complete }` observation fails the read, as does a candidate missing an id, name, description, category, or version, carrying a non-finite `order` or `rank`, or claiming a provider name other than its own — a malformed candidate is refused where its producing provider can still be named, rather than reaching a surface as a blank entry. A caller's `signal` aborts a listing even while an unresponsive provider is still working.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design behind the registry; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The registry owns three things and nothing else: which providers exist, which candidate wins an id, and one cached catalog. It deliberately has no scope layering — unlike `ctx.skills`, a pack is bound to a workspace rather than contributed per agent scope, so the registration set is flat and a single cached observation serves every reader.

Caching is keyed on a monotonic revision rather than on time. Every registration, disposal, and provider `invalidate()` advances the revision, drops the cache, and emits `packs/change`; a snapshot is stored only when discovery completed AND the revision did not move while providers were being awaited, so a catalog that changed mid-read is never cached under the newer revision.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The service: registration, catalog merging, precedence, caching, and change notification |
| [`src/types.ts`](src/types.ts) | The vocabulary shared by every pack surface — identity, display metadata, rows, and the provider contract |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages move from the seam this package defines to the composition machinery a pack's rows eventually reach.

- [Pack subsystem](../../../docs/subsystems/pack.md) — the family's vocabulary and the roles around this registry.
- [dsh-skill](../../skill/skill/README.md) — the registry this one is modeled on, and the seam a pack's skills reach.
- [dsh-agent-presets](../../preset/agent-presets/README.md) — the per-session composition machinery whose row grammar `PackRow` mirrors.
- [Capability seams](../../../docs/capability-seams.md) — the Service Definition / Service Provider / Consumer split this family follows.

-----

<a id="model-experience"></a>
## Model Experience

### Pack catalogs and composition rows

#### What the model sees

Nothing. `ctx.packs` serves catalogs and rows to host-side consumers only: the package registers no tools, injects no prompts, and writes no session events, so no request field ever carries this package's data. What a mounted pack's own rows contribute is that row's contract, not this registry's.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define where this registry stops. They are current package constraints, not a task backlog.

- **The seam has no provider and no consumer yet** — this package alone lists nothing and mounts nothing. A source that discovers packs, a store that binds them to a workspace, and the composition step that mounts a bound pack's rows are separate packages that do not exist yet, so a deployment mounting only this row gains no behavior.
- **Nothing validates a pack's rows** — `PackRow` is carried verbatim from a provider to whoever mounts it. A row naming a module that cannot resolve fails at mount time, in the consumer, not at listing time here.
- **The cache is all-or-nothing** — one provider's `invalidate()` drops the whole catalog and every provider is asked again on the next read. With the small provider counts this seam is built for that is cheaper than per-provider bookkeeping; a deployment with many slow remote sources would notice.
- **An incomplete observation is never cached** — a persistently failing provider makes every read re-ask every provider. There is no backoff, so a consumer that polls sets the retry rate itself.
- **Precedence is not reported** — the catalog shows the winner alone. A surface cannot tell a user that their pack shadowed a bundled one of the same id, because the losing candidates are dropped during merging.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is non-authoritative working context: undecided directions and notes for maintainers. Shipped behavior and accepted rationale live in the sections above and in the package code.

- Whether `PackDefinition` should carry rows inline or a composition file path is settled for now in favor of rows, because a remote provider cannot hand back a path. A filesystem provider that already owns a real composition file will have to materialize rows from it, and if that proves lossy the definition may need to carry both.

</details>

**Runtime invariant:** No companion is published. The registry is the single authority on which providers exist and which candidate wins an id; no independent observation of that relation exists to diverge from it.
