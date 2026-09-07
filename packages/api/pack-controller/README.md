---
description: "The pack Remote namespace: the catalog a gallery renders, the per-directory bindings a project page writes, and what each verb answers when a directory is gone."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-pack-controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-pack-controller` is the Remote surface behind "add plugin X to project A". It serves two things over one namespace: the pack catalog this installation may see, and which packs each project directory has turned on. It owns wire concerns only — validating a request, projecting a summary onto its browser-safe view, and classifying a refusal — while the registry decides what exists and each provider decides what this installation may see. Mount it in a Host composition that offers packs; a browser page, a CLI, or any other Remote client then reads and writes bindings without touching storage.

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

Mount the plugin beside the Typert registry and the pack seam; it takes no configuration.

### When to choose it

Choose it whenever a client outside the Host process turns packs on and off. Skip it in a deployment that binds packs from its own composition — a fixed set of packs needs no per-directory surface, and the namespace would answer questions nobody asks.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-api-pack-controller'
```

The controller injects `typert`, `packs`, and `packBindings`. It stays pending until all three exist, rather than registering a namespace whose every verb would fail: `dsh-base` composes the pack seam unconditionally, so an absent `pack` namespace means those rows were removed, which a startup audit reports.

### The verbs

| Verb | Answers |
|---|---|
| `catalog()` | every pack this installation may see, in display order, plus whether discovery was authoritative |
| `bindings(directory)` | the pack ids one directory has turned on |
| `bind(directory, packs)` | replaces that list and answers the stored one |
| `boundDirectories()` | every directory that has packs bound, for a management view |

`bind` is a replacement rather than a merge, and an empty list unbinds the directory. It stores an id no provider currently serves, so an uninstalled pack returns when its provider does; the cost is that a typo is stored as readily as a real id.

### Directory identity on the wire

A response echoes the directory **as the caller spelled it**, so a page keyed by the path a user picked does not have to re-key itself on every response. The store canonicalizes with `fs.realpath` internally, and `boundDirectories()` is the one verb that answers those canonical keys, because a management view lists what is stored rather than what someone asked about.

### Failures and recovery

A read of a directory that cannot be resolved — deleted, or never created — answers empty rather than failing, because a project page must still render for a folder that moved. A write to such a directory is refused with `pack/unresolvable-directory`, because binding a pack to a directory that is not there is a caller mistake worth reporting. A malformed request — a blank path, a non-list of ids — is refused as `gateway/bad-request` before it reaches the store.

An incomplete catalog is reported rather than hidden: `complete: false` means some provider failed or reported partial discovery, and a client reading it should keep its own last-good listing rather than treat a missing pack as uninstalled.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Why the wire view is narrower than the seam

`PackSummary` carries a `resourceBase`, which for the local provider is an absolute host path. The Gateway returns a business result without decoding it, so returning the seam's own object would serialize that path — and any other enumerable property a provider attached — to a browser. Every field is therefore copied by name into `PackSummaryView`, the same defense `dsh-api-settings-controller` applies to a settings descriptor.

That leaves an icon unresolved: `icon` crosses as the pack declared it, with no base to resolve it against, so a client cannot yet fetch one.

### Where entitlement is not

Nothing here filters a catalog. A provider lists what the current installation may see, so an unentitled pack never enters a catalog and cannot reach this controller. Filtering here instead would mean the pack's contents had already crossed into a surface that was not allowed to hold them.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The Remote service: verbs, request admission, and failure mapping |
| [`src/types.ts`](src/types.ts) | Browser-safe wire views and the failure vocabulary |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-pack](../../pack/pack/README.md) — the registry whose catalog this namespace serves.
- [dsh-pack-binding](../../pack/pack-binding/README.md) — the store behind the binding verbs, and the path canon they inherit.
- [dsh-typert-protocol](../../typert/protocol/README.md) — the `@Remote` decorator, `RemoteError`, and how a namespace reaches a client.
- [Pack subsystem](../../../docs/subsystems/pack.md) — the family this surface sits above.

-----

<a id="model-experience"></a>
## Model Experience

### The pack Remote namespace

#### What the model sees

Nothing. This package serves Remote clients only: it registers no tools, injects no prompts, and writes no session events. Neither `catalog()` nor `bind(directory, packs)` reaches a model request. What a bound pack contributes to a model is that pack's own contract, reached through `ctx.packMount` at session creation rather than through this namespace.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Indirect and deferred. A `bind` call changes what a *later* session composes; a session already running keeps the composition it started with, so no live request prefix moves when a binding does.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define where this surface stops. They are current package constraints, not a task backlog.

- **No icon resolution** — `icon` crosses as the pack declared it and `resourceBase` is deliberately withheld, so a client has no way to fetch a pack's icon. Serving pack assets needs a route this package does not own.
- **No change notification** — the registry's `packs/change` event is not projected onto the namespace, so a client polls `catalog()` rather than following it. Every other Remote surface here answers one call at a time; a follow stream is the next addition when a live gallery needs one.
- **Whole-list writes only** — `bind` replaces, matching the store beneath it, so two clients editing one directory concurrently can lose an edit. There is no revision fence.
- **No validation against the catalog** — an id no provider serves binds successfully. That is deliberate, so an uninstalled pack can return, but a typo is indistinguishable from a temporarily absent pack.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is non-authoritative working context: undecided directions and notes for maintainers.

- A follow stream over `packs/change` is the obvious next addition and would reuse the reconnect-safe frame pattern `dsh-api-workspace-controller` already implements. It is unbuilt because no client renders a live gallery yet.

</details>

**Runtime invariant:** No companion is published. Every answer is derived from the registry and the binding store at call time; this package retains no relation of its own that a second observation could contradict.
