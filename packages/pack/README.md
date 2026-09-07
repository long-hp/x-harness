---
description: "The pack group map: installable bundles of agent behavior — rules, skills, hooks, commands, subagents, and MCP servers — that a user turns on for a project, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/pack

English | [中文](README.zh.md)

## Summary

The pack group provides packs: named bundles of agent behavior a user turns on for one project rather than for one session. A pack carries whatever a project's way of working needs — instruction rules, skills, hooks, commands, subagents, and MCP servers — and a workspace that has a pack bound to it composes every new session with that pack's contributions. The group exists so those bundles have one identity, one catalog, and one precedence rule no matter where they come from: a directory, a package, or a licensed remote service. This page maps the group; each package README owns its own contract.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`pack`](pack/README.md) | Registry that merges pack catalogs from any provider and loads the winning pack's composition rows | `ctx.packs` |
| [`pack-local`](pack-local/README.md) | Serves packs from local directories, reading each pack's manifest, rules, and skills | registers on `ctx.packs` |
| [`pack-rules`](pack-rules/README.md) | Realizes one pack's instruction rules as prompt sections in its mounting scope | — |
| [`pack-binding`](pack-binding/README.md) | Remembers which packs a project directory turned on | `ctx.packBindings` |
| [`pack-mount`](pack-mount/README.md) | Composes one agent from the packs its directory turned on | `ctx.packMount` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Pack subsystem](../../docs/subsystems/pack.md) — the group's vocabulary, the roles around the registry, and what each role owns.
- [Skill subsystem](../../docs/subsystems/skills.md) — the seam a pack's skills reach, and the registry this group's own is modeled on.
- [`AgentPresets` reference](../../docs/subsystems/core.md#ctxagentpresets--agentpresets) — the per-session composition machinery a pack's rows join.
- [Capability seams](../../docs/capability-seams.md) — the Service Definition / Service Provider / Consumer split this group follows.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Every role the family needs to run is in place: a registry, a local provider, the rules Consumer, the binding store, and the mounting step the session entry point calls. What is missing is a surface — nothing but a direct API call turns a pack on for a project yet — and the loaders for a pack's hooks, commands, subagents, and MCP servers.

</details>
