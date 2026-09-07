---
description: "Serves packs from local directories: the pack.yml manifest, the rules/, skills/, and hooks/ layout, root precedence, and the composition rows a pack produces."
kind: "package-reference"
---

# @deepseek-ai/dsh-pack-local

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-pack-local` makes a directory on this machine into a pack a user can turn on for a project. Point it at one or more roots; every child directory holding a `pack.yml` becomes a listed pack, taking its id from the directory name and its display text from the manifest. When a pack is loaded, the package turns its `rules/*.md`, `skills/`, and `hooks/hooks.json` contents into the composition rows a bound session mounts, reusing the rule, skill, and hook plugins that already exist rather than inventing a second way to deliver any of them. Mount one instance per source you want to distinguish — bundled packs and the user's own, for example — because the provider name and root precedence are per instance.

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

Mount the plugin beside [`dsh-pack`](../pack/README.md) and give it the directories to scan.

### When to choose it

Choose it whenever packs live on the machine running the harness — a repository's own pack directory, a shared team directory, or the user's personal one. It is the wrong choice when a pack's contents must stay unreadable to the person using it: a directory on that person's disk is readable regardless of what any catalog reports, so gated content belongs to a provider that returns it against a token.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-pack-local'
  config:
    roots:
      - path: ~/.dsh/packs
```

| Field | Default | Meaning |
|---|---|---|
| `roots` | `[]` | Scanned directories in precedence order; a leading `~` expands |
| `roots[].path` | required | Directory holding pack directories |
| `roots[].rank` | `300` | Precedence for this root's packs; lower wins a duplicate id |
| `providerName` | `local` | Provider name in `ctx.packs`; distinct per mounted instance |
| `maxRuleBytes` | `65536` | Byte cap for one rule file; a larger file is skipped |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-pack-local) is the exhaustive source for every accepted field.

### A pack on disk

```text
~/.dsh/packs/
  viet-truyen/
    pack.yml              display text; its presence is what makes this a pack
    rules/
      1-voice.md          one prompt section each, in filename order
      2-length.md
    skills/
      outline/SKILL.md    an ordinary skill directory
    hooks/
      hooks.json          Claude Code hook config, read by the existing bridge
      check.sh            reached from a command through ${CLAUDE_PLUGIN_ROOT}
```

The id is the directory name — `viet-truyen` above — and never a field inside `pack.yml`, so a locally authored pack cannot claim an id it did not write. A directory whose name is not kebab-case is skipped, as is one holding no `pack.yml`.

Every `pack.yml` field is optional:

| Field | Default | Meaning |
|---|---|---|
| `name` | the pack id | Display name |
| `description` | empty | One sentence shown beneath the name |
| `category` | `general` | Grouping label |
| `version` | `0.0.0` | Version shown for support |
| `order` | discovery position | Display position; lower comes first |
| `icon` | absent | Path relative to the pack directory |

A manifest that cannot be parsed, or that holds a scalar instead of a mapping, yields empty metadata rather than hiding the pack: presentation is not a capability, and a pack with a broken name still carries usable rules and skills. Fields of the wrong type are individually ignored for the same reason.

### What a pack becomes

| Pack contents | Row |
|---|---|
| `rules/*.md` | one [`dsh-pack-rules`](../pack-rules/README.md) row whose sections carry each file's text, named `pack:<id>:<filename>` |
| `skills/` (non-empty) | one [`dsh-skill-filesystem`](../../skill/skill-filesystem/README.md) row pointed at that directory, with `includeDefaultRoots: false` and `providerName: pack:<id>` |
| `hooks/hooks.json` | one [`dsh-hooks-claude-code`](../../hooks/hooks-claude-code/README.md) row whose `pluginRoot` is the pack directory |

Rows come in that order. Only `.md` files directly under `rules/` are read — no recursion — and a file over `maxRuleBytes` is skipped rather than truncated, because half an instruction is worse guidance than none. A pack shipping none of the three still lists: binding it is a meaningful action once it gains contents.

The hook row sets `pluginRoot` to the pack directory, so a pack written for Claude Code reaches its own scripts through `${CLAUDE_PLUGIN_ROOT}` unchanged. It leaves `projectDir` unset: `CLAUDE_PROJECT_DIR` then defaults per run to the session's own working directory, which for a bound pack is the project it was turned on for rather than the pack's directory.

A composition that mounts bound packs must also have `dsh-pack-rules`, `dsh-skill-filesystem`, and `dsh-hooks-claude-code` resolvable, since those are the module names the generated rows carry.

### Precedence across roots

Roots are scanned in configuration order and every pack takes its root's `rank`. Two roots publishing the same id resolve by rank first, so an explicit lower rank on a later root lets it win; at equal rank the earlier root wins, because the registry breaks a tie by the order the provider listed its packs.

### Failures and recovery

A root that does not exist yields no packs and still counts as a completed scan — a deployment may configure a personal pack directory before creating it. Any other read failure logs the root and leaves discovery incomplete, so an unreadable root never reads as "this root holds no packs" and a surface can retain its last-good listing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

Each contribution kind reuses a plugin that already exists. That is why rules become a `dsh-pack-rules` row rather than a prompt registration made here, and why skills become a `dsh-skill-filesystem` row rather than a second discovery implementation: the skill provider already owns frontmatter parsing, watching, and precedence, and its `providerName` and `includeDefaultRoots` fields were enough to scope one instance to one pack without touching that package.

Rules carry text rather than paths so the same `PackDefinition` shape works for a provider with no filesystem. That decision belongs to the seam, not to this package; here it only means rule files are read during `get()` rather than named in it.

Hooks are the exception, and deliberately so: a hook is a command line, and a pack's commands run its own scripts. Those scripts must exist on the host that runs them, so a hook-bearing pack is filesystem-bound whatever a provider does with the rest of its contents. The row therefore carries the config path and lets the bridge read it.

Discovery is unmemoized. `list()` rescans its roots on every registry miss, and the registry's own cache is what keeps that from happening per read.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config, root resolution, candidate projection, provider registration |
| [`src/discovery.ts`](src/discovery.ts) | Root scanning and `pack.yml` reading |
| [`src/rows.ts`](src/rows.ts) | Turning a pack directory's contents into composition rows |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-pack](../pack/README.md) — the registry this provider registers on, and the precedence rules it participates in.
- [dsh-pack-rules](../pack-rules/README.md) — the row a pack's `rules/` becomes.
- [dsh-skill-filesystem](../../skill/skill-filesystem/README.md) — the row a pack's `skills/` becomes.
- [dsh-hooks-claude-code](../../hooks/hooks-claude-code/README.md) — the row a pack's `hooks/hooks.json` becomes, and the events it covers.
- [Pack subsystem](../../../docs/subsystems/pack.md) — the family and the roles around this provider.

-----

<a id="model-experience"></a>
## Model Experience

### Pack contents reaching a session

#### What the model sees

Nothing directly. This package produces composition rows; what a mounted row contributes is that row's own contract — `dsh-pack-rules` for the prompt sections a pack's rules become, `dsh-skill-filesystem` for the skills its catalog publishes, and `dsh-hooks-claude-code` for whatever context or decision a hook returns. Discovery, manifests, and root precedence never reach a request.

#### Token effect

Zero directly. The rows this package emits carry the cost: rules add their text to every request in the bound scope, skills add their name and description to the session's skill catalog, and a hook's `additionalContext` adds a message to the turn that ran it.

#### KV Cache effect

Indirect and one-time per session composition. Changing which packs a workspace binds, or editing a pack's contents, changes the rows a later session mounts and therefore its prompt prefix; a session already running is unaffected, because its rows were read when it was composed.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define where this provider stops. They are current package constraints, not a task backlog.

- **No watching** — adding, editing, or deleting a pack directory does not invalidate the registry's catalog. A surface sees the change only after something else invalidates it, so authoring a pack currently needs a restart to appear.
- **`commands/`, `agents/`, and `mcp.json` are ignored** — those loaders do not exist yet, so shipping them in a pack silently contributes nothing.
- **A pack's hooks reach only the events the bridge covers** — `dsh-hooks-claude-code` implements seven Claude Code hook events; a pack whose `hooks.json` names any other event has that entry dropped without a diagnostic from here.
- **A hook row is emitted for an unparsable `hooks.json`** — this package checks only that the file is readable, so a malformed config produces a row that registers no hooks and warns from the bridge instead.
- **No recursion under `rules/`** — only `.md` files directly in that directory are read; a nested folder of rules is invisible with no diagnostic.
- **An oversized rule file is dropped silently** — it is skipped rather than truncated, but nothing tells the user which file exceeded `maxRuleBytes`.
- **A pack that lost its manifest disappears** — `pack.yml` is the marker, so deleting it unlists the pack rather than reporting a pack that lost its metadata.
- **Nothing verifies the generated row modules resolve** — a composition missing `dsh-pack-rules`, `dsh-skill-filesystem`, or `dsh-hooks-claude-code` fails when a bound pack mounts, not when its pack is listed here.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is non-authoritative working context: undecided directions and notes for maintainers.

- Watching is the obvious next addition, and `PackProviderControl.invalidate()` exists for exactly it. It is unbuilt because the binding and mounting roles land first: until a pack can be turned on, there is no surface for a live catalog change to reach.

</details>

**Runtime invariant:** No companion is published. The provider derives every answer from the filesystem at read time and retains no relation of its own that a second observation could contradict.
