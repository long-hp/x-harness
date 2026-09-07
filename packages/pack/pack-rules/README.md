---
description: "Realizes one pack's instruction rules as scoped prompt sections, for users and maintainers composing packs or debugging where a pack's guidance reaches the model."
kind: "package-reference"
---

# @deepseek-ai/dsh-pack-rules

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-pack-rules` puts a pack's instruction rules into the system prompt of the sessions that pack is bound to. A pack provider reads whatever rule format it owns and emits one row of this plugin carrying the rule text; mounting that row registers each rule as a prompt section in the mounting scope alone, so a rule written for one project never reaches another. Rules travel as text rather than as file paths, because a pack may come from a remote provider with no filesystem the mounting process can read. You do not normally configure this plugin by hand — a pack provider generates its row — but the config is plain enough to write directly when a composition wants fixed guidance without a pack.

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

Mount the row inside the scope whose sessions should see the rules. A pack provider emits that row for you; the shape below is what it emits.

### When to choose it

Choose it to add guidance that several composed rules contribute, each surviving independently. Choose [`dsh-persona`](../../preset/persona/README.md) instead when a composition replaces *who the agent is* — a persona is one section per scope and a second one collides, while this plugin contributes as many named sections as its config lists. Choose [`dsh-agent-instructions`](../../context/agent-instructions/README.md) instead when the guidance lives in the user's own project as `AGENTS.md` or `CLAUDE.md`; that package discovers files under the session's working directory, which is exactly what a pack's rules are not.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-pack-rules'
  config:
    sections:
      - name: 'pack:viet-truyen:voice'
        text: 'Write in close third person.'
      - name: 'pack:viet-truyen:length'
        text: 'Chapters run 2000-3000 words.'
```

| Field | Default | Meaning |
|---|---|---|
| `sections` | `[]` | The rules this row contributes, in the order they should appear |
| `sections[].name` | required | Prompt-section name, unique within the mounting scope |
| `sections[].text` | required | Rule body; empty text drops the section at render |
| `sections[].order` | `PACK_RULES` slot | Position among prompt sections |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-pack-rules) is the exhaustive source for every accepted field.

### Where the rules land in the prompt

An omitted `order` uses the central `PACK_RULES` position: after the deployment persona, before plan policy and every tool section. That places a project's own way of working above the mechanics of the tools it uses, which is the order a reader of the assembled prompt expects.

### Naming and collisions

Section names are unique within one scope, and a duplicate throws at the section registry, failing the row's mount. That is deliberate: silently dropping the second rule would leave a user believing guidance is active when it is not. A pack provider therefore qualifies each name with the pack id it came from — `pack:<id>:<rule>` — so two packs bound to one workspace cannot collide.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin is one loop over its config: each entry becomes a `ctx.systemPrompt.section()` registration owned by a `ctx.effect`, so unloading the row withdraws exactly the sections it added. The fallback order is read once at apply time rather than per section, because the central slot cannot change while the row is mounted.

There is no file reading, no watching, and no parsing here. Everything a pack's rules needed from disk happened in the provider that produced this row.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The whole plugin: config schema and section registration |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-pack-local](../pack-local/README.md) — the provider that generates this row from a pack's `rules/` directory.
- [Pack subsystem](../../../docs/subsystems/pack.md) — where this row sits among a pack's contributions.
- [System prompt subsystem](../../../docs/subsystems/system-prompt.md) — section ordering, scoping, and assembly.
- [dsh-persona](../../preset/persona/README.md) — the one-per-scope identity section this plugin deliberately is not.

-----

<a id="model-experience"></a>
## Model Experience

### The pack rule sections

#### What the model sees

Each configured rule appears in the assembled system prompt as its own section, in `order` position, containing the rule text exactly as the provider supplied it. The section name is structural and is not shown to the model; only the text is. A rule whose text is empty contributes no section at render.

#### Token effect

Every mounted rule adds its full text to every request in that scope, for the life of the session. A pack bound to a workspace therefore costs its rules' tokens on each request, not once. Rules are not truncated by this plugin; a provider owns whatever cap it applies before emitting the row.

#### KV Cache effect

Rules sit in the stable system-prompt prefix, so they help rather than hurt reuse: identical rules across requests keep the prefix identical. Binding or unbinding a pack, editing a rule file, or reordering rules rewrites that prefix and ends reuse from the first changed section onward, which is why a rule change takes effect for sessions created afterwards rather than mid-conversation.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define where this row stops. They are current package constraints, not a task backlog.

- **Rules are fixed at mount** — the row carries text, so a rule edited on disk reaches only sessions composed after the edit. There is no watcher and no refresh path; a provider that wants live rules would need a different contribution shape.
- **No template variables** — the text is registered verbatim. Unlike a persona, it interpolates no `{{model}}` or `{{cwd}}`, so a rule cannot address the session it landed in.
- **A duplicate name fails the whole row** — one colliding section name prevents every rule in that row from mounting, not just the duplicate. That is loud rather than partial, but a provider emitting one bad name loses the rest of its pack's guidance with it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The plugin owns no relation that a second observation could contradict; its sections are held by the prompt registry, which is their single authority.
