---
description: "Composes one agent from the packs its workspace directory turned on (ctx.packMount): row namespacing, the scope guarantee, and what a missing or broken pack does to session creation."
kind: "package-reference"
---

# @deepseek-ai/dsh-pack-mount

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-pack-mount` is the step that makes a pack binding mean something: given an agent's scope and its working directory, it reads the packs that directory turned on, loads their composition rows, and mounts them under that agent alone. Everything a pack contributes — prompt sections, tools, skills, hooks, MCP servers — therefore reaches the sessions of one workspace and no other, because the harness dispatches agent and tool events along the scope chain. Mount it in a composition that offers packs; the session entry point calls it through `ctx.get('packMount')`, so a deployment without it composes exactly as before.

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

Mount the plugin beside the pack registry and the binding store. It publishes `ctx.packMount`; nothing else in a composition needs to change.

### When to choose it

Choose it in any composition where packs should actually run. Without it, packs can be listed and bound but never compose into a session — which is a reasonable posture for a deployment that only manages packs on behalf of another host, and the wrong one everywhere else.

### Minimal configuration

The plugin takes no configuration.

```yaml
- name: '@deepseek-ai/dsh-pack-mount'
```

### What a mount does

`mount(agentCtx, cwd)` is called from an unpublished agent's `setup`, before the agent is published and therefore before its first request:

1. Read the pack ids bound to `cwd`.
2. Load each pack's rows, skipping ids no provider serves.
3. Mount every row under `agentCtx` as one entry tree.
4. Refuse the whole mount if any enabled row did not reach a usable state.

Packs mount after the agent preset, so a workspace's packs layer over the composition its preset chose.

Every entry point that opens a session makes this call: the Remote session controller behind the browser application, plus the headless runner, the ACP bridge, the SDK server, and the webhook driver. The call is repeated because a `setup` callback belongs to whoever creates the agent, and there is no shared point between them that still runs before publication. A new entry point that omits it withholds packs from a directory that has them bound, silently — check this list when adding one.

### The scope guarantee

A mount into a context that carries no scope is refused, because its registrations would apply to every agent in the process. With a scope, the harness's own dispatch does the rest: a listener registered by a pack row is admitted only for agents on that scope's chain, and a pack's tools and prompt sections file into that agent's registry layer. That is what keeps one project's packs out of another project's sessions.

### Row identity across packs

Two packs bound to one directory may each publish a row called `rules`. Every row is therefore mounted under `<packId>.<rowId>`, so the Loader never sees a duplicate entry id and neither pack has to know what the other named its rows.

### Failures and recovery

A bound pack no provider serves is logged and skipped: an uninstalled or unentitled pack must not make a workspace unopenable, and the binding stays so the pack returns when its provider does. A pack whose row cannot start, or whose enabled row sits waiting for a service the composition never supplies, fails the mount and rolls the whole tree back — a half-composed agent would run without the behavior the user turned on and give no sign anything was missing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### The inline entry tree

`Include` is the Loader's file-backed tree, and a pack's rows arrive in memory from a provider that may have no filesystem at all. `PackTree` is therefore a small `EntryTree` subclass that takes rows directly, writes nothing, and — unlike `Include` — does not rewrite its context's `baseUrl`, so a bare package name in a row resolves from wherever the host composition resolves its own dependencies.

`EntryTree`'s constructor files every new tree under the nearest owning Loader entry's `subtree` slot. Left in place, a Loader walk would report one agent's pack rows as entries of the application itself, so the constructor reclaims the slot.

### The activation audit

A directly-plugged subtree is absent from `ctx.loader.entries()`, so no boot audit covers it. The Loader already rejects a row whose module or plugin threw; the remaining shape is an enabled row still waiting for a service it injected, which would sit silently inert. `dsh-agent-presets` applies the same rule to preset rows — the two are deliberate duplicates rather than a shared import, because that package ships only with the browser application while packs compose in every profile.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The service: binding lookup, row collection, mounting, and the activation audit |
| [`src/tree.ts`](src/tree.ts) | The inline entry tree a mount plugs into the agent's scope |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-pack-binding](../pack-binding/README.md) — the store this reads to learn what a directory turned on.
- [dsh-pack](../pack/README.md) — the catalog the bound ids resolve through.
- [Scoped registration](../../../docs/subsystems/scope.md) — the dispatch rule that makes a mounted pack reach one agent.
- [`AgentPresets` reference](../../../docs/subsystems/core.md#ctxagentpresets--agentpresets) — the per-session composition packs layer over.
- [Pack subsystem](../../../docs/subsystems/pack.md) — the family and the roles around this step.

-----

<a id="model-experience"></a>
## Model Experience

### A bound pack's contributions

#### What the model sees

Whatever the mounted rows contribute, and nothing from this package itself. A pack's rules become prompt sections through `dsh-pack-rules`, its skills join the session's skill catalog through `dsh-skill-filesystem`, and its tools join the visible tool set — each under its own package's contract. The `<packId>.<rowId>` names this package assigns are Loader entry ids, never model-visible text; binding, row namespacing, and the activation audit all stay out of the request.

#### Token effect

Zero directly; the mounted rows carry the cost, on every request in that agent's scope for the life of the session. A directory with several packs bound pays for all of them.

#### KV Cache effect

Fixed for the life of an agent. The mount runs once, before the agent is published and therefore before its first request, so a pack's contributions establish that agent's prefix rather than changing it mid-conversation. Two agents in differently bound directories establish different prefixes; neither can invalidate the other's reuse. Changing a binding or a pack's contents affects sessions composed afterwards.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define where this step stops. They are current package constraints, not a task backlog.

- **No service-leak check** — a pack row that publishes a service into the root realm becomes process-global rather than per-session, and the second directory mounting that pack collides with the first. `dsh-agent-presets` rejects that for preset rows; the equivalent audit is not implemented here, so a pack shipping such a row fails confusingly at the second workspace instead of clearly at the first.
- **Composition is fixed at session creation** — bindings are read once in `setup`. Turning a pack on or off affects sessions created afterwards, and a running session keeps the composition it started with.
- **A skipped pack is only logged** — a bound pack no provider serves leaves no durable record a surface could show, so a user sees a pack listed as bound with nothing explaining why it did nothing.
- **Row order is binding order** — packs mount in the order the binding list stores, and rows within a pack in provider order. Nothing lets one pack declare that it must come after another.
- **No end-to-end coverage through real package names** — the mount, the row shapes, and the scope guarantee are each covered, but no test yet boots a built profile in which a pack's generated rows resolve `@deepseek-ai/dsh-pack-rules` and `@deepseek-ai/dsh-skill-filesystem` by name. That link belongs to the profile-level composition tier.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is non-authoritative working context: undecided directions and notes for maintainers.

- The service-leak audit and the activation audit both exist in `dsh-agent-presets` in nearly this form. Extracting them into a shared home would remove the duplication this package accepted; the blocker is that `agent-presets` ships only with the browser application, so the shared home cannot be that package.

</details>

**Runtime invariant:** No companion is published. The mounted tree is owned by the agent's fiber and unwinds with it; the package retains no relation of its own that a second observation could contradict.
