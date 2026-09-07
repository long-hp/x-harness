# Agent Note: 项目目录用已绑定的 pack 组装它的会话

Status: implemented

[English](2026-09-07-workspace-bound-packs.md) | 中文

## Problem

同时做多个项目的人希望每个项目按各自的方式工作：写小说的目录带写作 rules 与 skills，做账的目录带另一套，两者互不渗漏。harness 本已具备全部原料——经由提示片段的指令 rules、经由 `ctx.skills` 的 skills、经由 Claude Code 桥的 hooks、经由 `ctx.tools` 的工具——却没有办法把它们打成一个用户可以为某个目录开启的具名包。

既有的两种组装机制回答的都是别的问题。[agent preset](2026-08-03-per-session-agent-presets.zh.md) 回答「这个会话是哪一类 Agent」，按会话选择、创建时固定。skill 目录回答「模型可以加载哪些指令」，按项目发现，但既不成包也不可切换。两者都没有用户可以开启的身份，也都不绑定到目录。

显而易见的读法是：按目录的行为需要一个新的分发层级，好让一个项目的监听器不为另一个项目触发。并不需要。Agent 与工具事件本就沿 scope 链分发：`scopeTarget` 全局放行未打标签的监听器，放行标签位于被分发 Agent scope 链上的监听器，并排除其他所有标签（[`packages/core/scope/src/index.ts`](../../../../packages/core/scope/src/index.ts)）。缺的是把**一组组合行**指向某一个 Agent scope 的办法，以及「哪一组」的持久记录。

## Decision

**pack** 是绑定到项目目录的具名 Agent 行为包。在该目录中启动的每个会话，都会在它所选 preset 之上，用绑定到该目录的 pack 组装出来。

该家族分为五个包，各自拥有一个角色：

| 包 | 角色 |
|---|---|
| `dsh-pack`（`ctx.packs`） | 注册表：合并任意提供方的 pack 目录、解析同名 id、加载胜出 pack 的组合行 |
| `dsh-pack-local` | 提供方：从本机目录提供 pack |
| `dsh-pack-rules` | Consumer：把一个 pack 的 rules 落为其挂载 scope 内的提示片段 |
| `dsh-pack-binding`（`ctx.packBindings`） | 持久化的「目录 → pack」记录 |
| `dsh-pack-mount`（`ctx.packMount`） | 读取绑定，并把组合行挂载到某一个 Agent 的 scope 之下 |

每个打开会话的入口点，都会在尚未发布 Agent 的 `setup` 中、于任何 preset 挂载之后调用 `ctx.get('packMount')?.mount(agentCtx, cwd)`：`ApiSessionAgentController.composeAgent()` 服务浏览器应用与 Remote API，`dsh-headless` 服务其启动目录，`dsh-acp` 服务 `newSession` 的 cwd，`dsh-sdk-server` 服务 `initialize` 时指名的目录，`dsh-webhook` 服务解析出的 workspace 路径。不挂载任何 pack 组合行的部署在那里读到 `undefined`，组装方式与此前完全一致。

这次调用是重复的而非集中的，因为 `setup` 回调属于创建该 Agent 的一方；它们之间不存在一个仍在发布之前运行的共享点。这种重复正是让路径键名副其实的原因——清单中被漏掉的 profile 会对一个已绑定 pack 的目录静默地不给出 pack，而那恰恰是选用该键所要防止的失败。

这些组合行位于 [`dsh-base`](../../../../packages/bundle/base/cordis.patch.yml) 而非浏览器 bundle，因此每个以 base 为底的 profile 都能够组装 pack——这正是下文以路径为键的绑定的意义所在。`dsh-pack-local` 扫描 `<dshHome>/packs`。`dsh-pack-rules` 是该 bundle 的依赖却没有自己的行，因为 `dsh-pack-local` 在它生成的组合行中指名了它，而那些行从该 bundle 解析。

### pack 的内容成为 Cordis 组合行

pack 的内容是异质的——rules 是提示片段，skills 是目录条目，hooks 是 shell 进程，MCP server 是外部连接——而 harness 已经有一种覆盖全部这些的表示：Cordis 插件行。因此 `PackRow` 参照 `agent.cordis.yml` 条目，挂载复用 Loader 自身的 entry 机制，而不是为安装任何东西新增第二套方式。

每种贡献都复用一个已经存在的插件。skills 成为一行 `dsh-skill-filesystem`，带 `providerName: pack:<id>` 与 `includeDefaultRoots: false`，这已足以把一个实例限定到一个 pack 而无需改动那个包。hooks 成为一行 `dsh-hooks-claude-code`，其 `pluginRoot` 设为该 pack 目录，因此为 Claude Code 编写的 pack 无需改动即可运行。只有 rules 需要新的 Consumer：`dsh-persona` 每个 scope 只有一条、第二条会冲突，而 `dsh-agent-instructions` 在**会话**的工作目录下发现文件，那恰恰不是 pack rules 所在之处。

rules 以文本而非文件路径传递，因为一个 pack 可能来自远程提供方，挂载进程没有可读的文件系统。这正是让同一个 `PackDefinition` 形状日后也能服务需授权远程来源的原因。

hooks 是刻意的例外，以配置路径传递。一个 hook 是一条命令行，而 pack 所携带的命令通过 `${CLAUDE_PLUGIN_ROOT}` 运行它自己的脚本；那些脚本必须存在于运行它们的宿主上。因此携带 hook 的 pack 无论提供方如何处理它其余的内容，都是与文件系统绑定的；把该文件的字节放进组合行不会带来任何好处，反而会迫使桥接多长出第二种输入。

### 绑定以规范目录路径为键

绑定记录以目录的 `fs.realpath` 为键，而不是以 `WorkspaceId` 为键。`dsh-workspace` 只随 `web-app` bundle 发布，而 `storage-domain` 随 `dsh-base` 发布，因此以 workspace id 为键会悄悄地只把 pack 给浏览器会话，却对同一文件夹中的 headless、SDK 或 ACP 运行不给。路径键也在项目被移出 workspace 列表又重新加入（这会铸造新的 workspace id）之后依然存续。

### 授权属于提供方

注册表没有授权概念。提供方只列出当前安装可见的内容，因此未获授权的 pack 从不进入目录，其组合行也不会到达任何可能泄露它们的消费者。若改为在消费者中过滤，则意味着 pack 的内容早已越界进入了本不该持有它们的接口。

这也界定了打包所能保护的边界：文件位于用户自己机器上的 pack，无论目录清单如何报告，该用户都能读取。必须保持不可读的内容，属于凭令牌返回它的远程提供方。

## Alternatives considered

**扩展 agent preset 而不是新增一个家族。** preset 本就是指向 Agent scope 的组合，因此把 preset 绑定到目录看起来机制更少。它败在默认值上：生效的 preset 从 `agent-presets.default` 这个全局值解析，因此按目录的选择必须由每个调用方传入。只有我们控制的界面会传——webhook、SDK、ACP 与 headless 会静默地在没有 pack 的情况下组装。它还把用户分别回答的两个问题混为一谈：这是哪一类 Agent，以及这个项目怎么干活。

**为每个 workspace 生成一个 preset 目录。** 这完全不需要改动核心：把「基础 preset + pack 组合行」物化成一个 preset 目录，让 roster 找到它。因同样的渗漏而被否决——生成的 preset 仍然必须按 id **被选中**，于是同样那些界面会错过它——也因为它把派生产物变成持久物，却没有谁负责清理。

**在 `PackDefinition` 中携带组合文件路径而非组合行。** 文件系统提供方本就有真实文件，路径对它更便宜。因远程提供方交不回路径而被否决，而该 seam 必须无需第二种形状即可服务两者。文件系统提供方改为从它的文件物化出组合行。

**导入 preset 挂载的 `inactiveRows` 审计。** `dsh-agent-presets` 出于同样理由已经实现了同一条谓词。因那个包只随浏览器应用发布、而 pack 在每个 profile 中都要组装而被否决；导入它会把一个只属于 web 的包拖进 headless 与 SDK 部署。该重复是刻意的，并在两处都做了标注。

**为目录清单加入 `broken` 报告。** `dsh-agent-presets` 会把损坏的 preset 连同原因列出而不是隐藏它，那是更好的用户体验。未构建：本地提供方把畸形清单退化为空元数据并保留该 pack，因此当前没有任何提供方会产出「能列出却加载不了」的 pack。在提供方需要它之前就加入该状态属于臆测。

## Consequences

**pack 的 hooks 由桥接被挂载在何处来限定 scope，而不是由桥接自身做了什么。** `dsh-hooks-claude-code` 什么都没改。它 README 中的限制——一份配置适用于整个进程、启动时读取一次——对宿主层级的挂载依然成立，而那根本不是 pack 所做的事。这正是组合行表示所换来的普适形态：某个既有插件的「按目录」版本，是一个挂载选择。

**pack 的贡献在会话创建时即固定。** 挂载在 `setup` 中只运行一次，在该 Agent 发布之前、因而也在它第一次请求之前。开启或关闭一个 pack 影响的是此后创建的会话；正在运行的会话保持它开始时的状态。这与 preset 的规则一致，也正是让一个会话已记录的工具调用仍可由它自己的组装发起的原因。

**绑定到同一目录的两个 pack 不可能在行 id 上冲突。** 每一行都以 `<packId>.<rowId>` 挂载，两个 pack 都不必知道对方把自己的行叫什么。

**无提供方服务的已绑定 pack 被跳过而非致命。** 被卸载或未获授权的 pack 不应让某个 workspace 无法打开，绑定也保留着，好让该 pack 在其提供方回来时一同回来。代价是用户看到一个被列为已绑定的 pack，屏幕上却没有任何东西解释它为何什么也没贡献——只有一行日志记录了它。

**把服务发布到根 realm 的 pack 组合行不会被拒绝。** `dsh-agent-presets` 会为此审计并拒绝；pack 尚未实现等价审计，因此这样的行会成为进程全局，而**第二个**挂载该 pack 的目录会与第一个冲突。这是一处具名的缺口，而不是已接受的设计：该审计应当与 `inactiveRows` 一起，放在两个包目前都无法提供的共享的家中。

**`composeAgent` 新增了 `cwd` 参数，且每个分支的 `setup` 都成为 async。** 它所强制的「无 scope 上下文」不变量现在以 rejection 而非同步抛出的形式落定。每个调用方都 `await` `setup`，因此在 Agent 工厂处可观察到的失败没有变化；直接调用方看到的是一个被拒绝的 promise。

**中央提示片段表新增了 `PACK_RULES: 100`**，位于部署 persona 与 plan policy 之间。项目自己的工作方式读起来在其所用工具的机制之上，而该槽位位于共享表中而非作为 `dsh-pack-rules` 内部的常量，因此未来的片段不可能与它静默冲突。

## Testing

scope 保证是被证明的，而不是被假定的。[`packages/preset/agent-presets/tests/listener-scope.spec.ts`](../../../../packages/preset/agent-presets/tests/listener-scope.spec.ts) 在一个 preset 组合中挂载一个只含监听器的行，并断言 `agent/pre-step` 与 `tools/pre-execute` 只抵达由它组装出的 Agent、同级被排除、以及释放一个 Agent 不影响另一个的注册。正是该测试使 `dsh-hooks-claude-code` 的「一份 hook 配置管整个进程」成为一个挂载选择，而非架构上的界限。

[`packages/pack/pack-mount/tests/composition.spec.ts`](../../../../packages/pack/pack-mount/tests/composition.spec.ts) 从一个 Loader entry 内部挂载 pack——正是会话入口所处的形态——并断言被组合行的 `subtree` 槽位被收回，因此 Loader 遍历绝不会把某个 Agent 的 pack 组合行报告为应用的 entry。

[`packages/pack/pack-mount/tests/hooks-composition.spec.ts`](../../../../packages/pack/pack-mount/tests/hooks-composition.spec.ts) 补上了该保证中剩下的缺口。scope 探针用的是一行注册了桥接所用同一批监听器的 fixture，而不是桥接本身——桥接需要 `ctx.shell`、`sessionProjections` 与一个配置文件。本测试经由真实的本地提供方挂载真实的 `dsh-hooks-claude-code`，并运行真实的 shell hook：两个绑定了不同 pack 的目录各自只看到自己那个 pack 的 hooks，且只有已绑定的会话记录 `hook/invoked`/`hook/result` 这一对。组合行通过源码平面的模块映射解析，这是「必须在干净树上通过的 Loader 组合测试」在本仓库的既有做法，因此它同时也钉住了 `dsh-pack-local` 所写入的确切模块名。

## Deferred

尚无测试启动一个已构建的 profile、在其中让 pack 生成的组合行按包名解析 `@deepseek-ai/dsh-pack-rules` 与 `@deepseek-ai/dsh-skill-filesystem`。挂载、组合行形状与 scope 保证各自都有覆盖，但那些模块名在真实组合中的解析属于 profile 级测试层，那一层会先构建 `lib/`。

pack 的 `commands/`、`agents/` 与 `mcp.json` 的加载器尚未构建；`dsh-pack-local` 只读取 `rules/`、`skills/` 与 `hooks/hooks.json`，因此今天把其余内容放进 pack 不会产生任何贡献。pack 的 hooks 也只能抵达桥接所实现的那七个 Claude Code 事件。`pack` Remote 命名空间已经存在，但没有任何已发布的界面调用它：绑定仍然是一次脚本化的调用，而不是用户可以点击的东西。
