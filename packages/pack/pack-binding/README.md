---
description: "Durable directory-to-pack bindings (ctx.packBindings): which packs a workspace directory has turned on, how a path is canonicalized, and what a read answers when a directory is gone."
kind: "package-reference"
---

# @deepseek-ai/dsh-pack-binding

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-pack-binding` remembers which packs a project directory has turned on. It stores one record per directory over the domain data form, keyed by the directory's canonical path, and answers "what does this directory run" for whoever is about to compose a session in it. It stores nothing about a pack itself — only the ids a directory selected — so a binding survives the pack changing, and a pack no provider currently serves simply contributes nothing until it returns. Mount it in any composition that offers packs; it is the durable half of "add plugin X to project A".

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

Mount the service beside a storage backend and the domain facility; it opens its own domain and needs nothing else.

### When to choose it

Choose it whenever packs are turned on per project. Skip it when a deployment gives every session the same fixed set of packs — that is a composition, and a per-directory store adds a lookup with one answer.

### Minimal configuration

The plugin takes no configuration.

```yaml
- name: '@deepseek-ai/dsh-pack-binding'
```

### Reading and writing

`for(path)` answers the pack ids bound to a directory, and `set(path, packIds)` replaces that list. `list()` returns every bound directory, for a management surface.

```ts
import type { Context } from '@deepseek-ai/cordis'
import { PackId } from '@deepseek-ai/dsh-pack'

declare const ctx: Context

await ctx.packBindings.set('/home/me/novel', [PackId('viet-truyen')])
await ctx.packBindings.for('/home/me/novel')  // ['viet-truyen']
```

`set` replaces rather than merges, duplicates collapse while order is kept, and an empty list removes the record — "bound to nothing" and "never bound" are one state rather than two.

### Why a path and not a workspace id

Bindings key on the directory's canonical path rather than on a `WorkspaceId`, because the workspace registry ships only with the browser application while a session can be opened in that directory by every profile. Keying on the path lets a headless or SDK run in the same folder compose from the same packs, and it survives a project being removed from the workspace list and added again.

The canon is `fs.realpath` over an absolute path, so a trailing slash, a `..` segment, and a symlink to the directory all read the same record. It is the same canon `dsh-workspace` applies to workspace paths; the two have to agree, or a registered project would key its bindings under a different string than the sessions that run in it.

### Failures and recovery

A read for a directory that cannot be resolved — deleted, or never created — answers empty rather than failing: a directory that is not there can hold no bindings, and session creation must not break because a folder moved. A write to such a path rejects with the underlying filesystem error, because binding a pack to a directory that does not exist is a caller mistake worth reporting.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The service is a thin typed face over one `bindings` table in its own storage domain. Reads are synchronous against the domain's in-memory table once the path is canonicalized; writes go through the domain's write chain, so concurrent updates to one directory never interleave. The domain is opened during service init and closed by a `ctx.effect` disposer, which frees the domain name for a later reopen when the composition reloads.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The service: domain lifetime, reads, and writes |
| [`src/spec.ts`](src/spec.ts) | The durable record schema and domain declaration |
| [`src/paths.ts`](src/paths.ts) | Path canonicalization for binding identity |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-pack-mount](../pack-mount/README.md) — the consumer that reads a binding and composes the agent from it.
- [dsh-pack](../pack/README.md) — the catalog the stored ids address.
- [Storage subsystem](../../../docs/subsystems/storage.md) — the domain data form this service persists through.
- [Pack subsystem](../../../docs/subsystems/pack.md) — where binding sits among the pack roles.

-----

<a id="model-experience"></a>
## Model Experience

### Stored bindings

#### What the model sees

Nothing. `ctx.packBindings` serves records to host-side consumers only: the package registers no tools, injects no prompts, and writes no session events. What the packs it names contribute is those packs' own contract, reached through the mount step rather than through this store.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse. Changing a binding changes what a *later* session composes, which is where any prefix change appears.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define where this store stops. They are current package constraints, not a task backlog.

- **Whole-list writes only** — there is no bind-one or unbind-one operation, so two surfaces editing one directory concurrently can lose an edit. The operation set will need a revision fence or per-pack writes once more than one surface exists.
- **A moved directory loses its bindings** — the key is the canonical path, so renaming a project directory silently unbinds it. Nothing detects the move or offers to carry the bindings across.
- **Nothing prunes stale records** — a binding for a directory that no longer exists stays stored and appears in `list()`; only a read for it answers empty.
- **No validation against the catalog** — an id no provider serves can be bound. That is deliberate, so an uninstalled pack can return, but it means a typo is stored as readily as a real id.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The path canon here duplicates `dsh-workspace`'s `realpathNormalize` rather than importing it: that package ships only with the browser application, and this one must work in every profile. A shared home for the canon — `packages/util/*` cannot hold it, being browser-safe and `fs`-free — would be the better eventual fix.

</details>

**Runtime invariant:** No companion is published. The stored table is the single authority on what a directory has bound; no independent observation of that relation exists to diverge from it.
