# Agent Note: A project directory composes its sessions from bound packs

Status: implemented

English | [中文](2026-09-07-workspace-bound-packs.zh.md)

## Problem

A person working on several projects wants each project to work its own way: a novel-drafting directory should carry drafting rules and skills, an accounting directory should carry different ones, and neither should leak into the other. The harness already had every ingredient — instruction rules through prompt sections, skills through `ctx.skills`, hooks through the Claude Code bridge, tools through `ctx.tools` — and no way to bundle them under one name a user turns on for one directory.

The two existing composition mechanisms both answer a different question. An [agent preset](2026-08-03-per-session-agent-presets.md) answers "what kind of agent is this session", chosen per session and fixed at creation. A skill directory answers "what instructions can the model load", discovered per project but not bundled or switchable. Neither has an identity a user can turn on, and neither is bound to a directory.

The obvious reading is that per-directory behavior needs a new dispatch tier so one project's listeners do not fire for another. It does not. Agent and tool events already dispatch along the scope chain: `scopeTarget` admits an untagged listener globally, admits a listener tagged with a key on the dispatched agent's scope chain, and excludes every other tag ([`packages/core/scope/src/index.ts`](../../../../packages/core/scope/src/index.ts)). What was missing is a way to point a *set of rows* at one agent's scope, and a durable record of which set.

## Decision

A **pack** is a named bundle of agent behavior bound to a project directory. Every session started in that directory composes from the packs bound to it, on top of whatever preset it chose.

The family splits into five packages, each owning one role:

| Package | Role |
|---|---|
| `dsh-pack` (`ctx.packs`) | Registry: merges pack catalogs from any provider, resolves a duplicate id, loads the winning pack's rows |
| `dsh-pack-local` | Provider: serves packs from directories on this host |
| `dsh-pack-rules` | Consumer: realizes one pack's rules as prompt sections in its mounting scope |
| `dsh-pack-binding` (`ctx.packBindings`) | Durable `directory → packs` records |
| `dsh-pack-mount` (`ctx.packMount`) | Reads a binding and mounts the rows under one agent's scope |

`ApiSessionAgentController.composeAgent()` calls `ctx.get('packMount')?.mount(agentCtx, cwd)` from the unpublished agent's `setup`, after the preset mounts. A deployment that mounts no pack rows reads `undefined` there and composes exactly as before.

### A pack's contents become Cordis rows

A pack's contents are heterogeneous — rules are prompt sections, skills are catalog entries, hooks are shell processes, MCP servers are external connections — and the harness already has one representation covering all of them: a Cordis plugin row. `PackRow` therefore mirrors an `agent.cordis.yml` entry, and the mount reuses the Loader's own entry machinery rather than adding a second way to install anything.

Each contribution kind reuses a plugin that already exists. Skills become a `dsh-skill-filesystem` row with `providerName: pack:<id>` and `includeDefaultRoots: false`, which was enough to scope one instance to one pack without touching that package. Only rules needed a new Consumer: `dsh-persona` is one section per scope and a second collides, while `dsh-agent-instructions` discovers files under the *session's* working directory, which is exactly where a pack's rules are not.

Rules travel as text rather than as file paths, because a pack may come from a remote provider with no filesystem the mounting process can read. That is what makes the same `PackDefinition` shape work for a licensed remote source later.

### Bindings key on the canonical directory path

A binding record is keyed by `fs.realpath` of the directory, not by `WorkspaceId`. `dsh-workspace` ships only in the `web-app` bundle while `storage-domain` ships in `dsh-base`, so a workspace-id key would silently give packs to browser sessions and withhold them from a headless, SDK, or ACP run in the same folder. A path key also survives a project being removed from the workspace list and added again, which mints a new workspace id.

### Entitlement belongs to the provider

The registry has no entitlement concept. A provider lists what the current installation may see, so an unentitled pack never enters a catalog and its rows never reach a consumer that could leak them. Filtering in a consumer instead would mean the pack's contents had already crossed into a surface that was not allowed to hold them.

This bounds what packaging can protect: a pack whose files sit on the user's own machine is readable by that user regardless of what a catalog reports. Content that must stay unreadable belongs to a remote provider that returns it against a token.

## Alternatives considered

**Extend agent presets instead of adding a family.** A preset is already a composition pointed at an agent scope, so binding presets to directories looks like less machinery. It fails on the default: the effective preset resolves from `agent-presets.default`, a global value, so a per-directory choice would have to be passed in by every caller. Only the surfaces we control pass it — webhook, SDK, ACP, and headless would silently compose without packs. It also conflates two questions a user answers separately: what kind of agent this is, and how this project works.

**Generate a preset directory per workspace.** This would need no core edit at all: materialize `base preset + pack rows` into a preset directory and let the roster find it. Rejected for the same leak — the generated preset still has to be *selected* by id, so the same surfaces miss it — and because it makes a derived artifact durable, with no owner for cleaning it up.

**Carry a composition file path in `PackDefinition` instead of rows.** A filesystem provider already has a real file, so a path is cheaper for it. Rejected because a remote provider has no path to hand back, and the seam must serve both without a second shape. A filesystem provider materializes rows from its files instead.

**Import the preset mount's `inactiveRows` audit.** `dsh-agent-presets` already implements the same predicate for the same reason. Rejected because that package ships only with the browser application, and packs compose in every profile; importing it would drag a web-only package into headless and SDK deployments. The duplicate is deliberate and marked as such at both sites.

**Add `broken` reporting to the catalog.** `dsh-agent-presets` lists a broken preset with a reason rather than hiding it, which is the better user experience. Not built: the local provider degrades a malformed manifest to empty metadata and keeps the pack, so no current provider produces a pack that lists but cannot load. Adding the state before a provider needs it would be speculative.

## Consequences

**A pack's contributions are fixed at session creation.** The mount runs once in `setup`, before the agent is published and therefore before its first request. Turning a pack on or off affects sessions created afterwards; a running session keeps what it started with. That matches the preset rule and is what keeps a session's logged tool calls callable by its own composition.

**Two packs bound to one directory cannot collide on a row id.** Every row mounts as `<packId>.<rowId>`, so neither pack has to know what the other named its rows.

**A bound pack no provider serves is skipped, not fatal.** An uninstalled or unentitled pack must not make a workspace unopenable, and the binding stays so the pack returns when its provider does. The cost is that a user sees a pack listed as bound with nothing on screen explaining why it contributed nothing — only a log line records it.

**A pack row that publishes a service into the root realm is not rejected.** `dsh-agent-presets` audits for that and refuses; the equivalent audit is not implemented for packs, so such a row becomes process-global and the *second* directory mounting that pack collides with the first. This is a named gap, not an accepted design: the audit belongs beside `inactiveRows` in a shared home neither package can currently provide.

**`composeAgent` gained a `cwd` parameter and an async `setup` in every branch.** The unscoped-context invariant it enforces now settles as a rejection rather than a synchronous throw. Every caller awaits `setup`, so the observable failure is unchanged at the agent factory; a direct caller sees a rejected promise.

**The central prompt-section table gained `PACK_RULES: 100`**, between the deployment persona and plan policy. A project's own way of working reads above the mechanics of the tools it uses, and the slot lives in the shared table rather than as a constant inside `dsh-pack-rules`, so a future section cannot silently collide with it.

## Testing

The scope guarantee is proven rather than assumed. [`packages/preset/agent-presets/tests/listener-scope.spec.ts`](../../../../packages/preset/agent-presets/tests/listener-scope.spec.ts) mounts a listener-only row in a preset composition and asserts that `agent/pre-step` and `tools/pre-execute` reach only the agents composed from it, that siblings are excluded, and that disposing one agent leaves another's registrations intact. That test is what makes the "one hook config for the whole process" limitation of `dsh-hooks-claude-code` a mounting choice rather than an architectural bound.

[`packages/pack/pack-mount/tests/composition.spec.ts`](../../../../packages/pack/pack-mount/tests/composition.spec.ts) mounts a pack from inside a Loader entry — the shape the session entry point has — and asserts the composed row's `subtree` slot is reclaimed, so a Loader walk never reports one agent's pack rows as entries of the application.

## Deferred

No test yet boots a built profile in which a pack's generated rows resolve `@deepseek-ai/dsh-pack-rules` and `@deepseek-ai/dsh-skill-filesystem` by package name. The mount, the row shapes, and the scope guarantee are each covered, but the resolution of those module names in a real composition belongs to the profile-level tier, which builds `lib/` first.

Loaders for a pack's `hooks/`, `commands/`, `agents/`, and `mcp.json` are unbuilt; `dsh-pack-local` reads `rules/` and `skills/` only, so shipping the others in a pack contributes nothing today. No surface turns a pack on: binding is an API call, with no Remote and no browser page behind it.
