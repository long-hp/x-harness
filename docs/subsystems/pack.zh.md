# Pack

[English](pack.md) | 中文

[pack 能力家族](../../packages/pack)让一个项目拥有自己的工作方式。**pack** 是具名的 Agent 行为包——指令 rules、skills、hooks、commands、subagents 与 MCP server——由用户为某个 workspace 开启；此后在该 workspace 中启动的每个会话都会带着这个 pack 的贡献被组合出来。pack 绑定到 workspace 而非会话，这正是它与 [agent preset](core.zh.md#ctxagentpresets--agentpresets) 的区别：preset 回答「这个会话是哪一类 Agent」，pack 回答「这个项目怎么干活」。

源码：[`packages/pack/pack/src/index.ts`](../../packages/pack/pack/src/index.ts)。

## 角色

本家族遵循[能力 seam](../capability-seams.zh.md) 的划分。目前只有第一个角色存在；其余角色在此命名，是为了让词汇保持稳定，并各自标注状态。

| 角色 | 拥有者 | 状态 |
|---|---|---|
| Service Definition | [`dsh-pack`](../../packages/pack/pack)（`ctx.packs`） | 已交付 |
| Service Provider | [`dsh-pack-local`](../../packages/pack/pack-local) 服务本机目录；需授权的远程提供方仍待定 | 本地已交付 |
| Consumer | [`dsh-pack-rules`](../../packages/pack/pack-rules) 落实 pack 的 rules；pack 的 skills 复用 [`dsh-skill-filesystem`](../../packages/skill/skill-filesystem) | 已交付 |
| Binding | [`dsh-pack-binding`](../../packages/pack/pack-binding)（`ctx.packBindings`） | 已交付 |
| Mounting | [`dsh-pack-mount`](../../packages/pack/pack-mount)（`ctx.packMount`），由会话入口的 Agent setup 调用 | 已交付 |

该家族运行所需的每个角色都已就位。缺的是界面：为项目开启一个 pack 目前是一次 API 调用，背后既没有 Remote 也没有浏览器页面。

## 绑定身份

绑定以目录的规范 `fs.realpath` 为键，而不是以 `WorkspaceId` 为键。`dsh-workspace` 只随浏览器应用发布，而该目录中的会话可以被每一个 profile 打开，因此路径键正是让 headless 或 SDK 运行与浏览器从同一批 pack 组装出来的东西。它也在项目被移出 workspace 列表又重新加入（这会铸造一个新的 workspace id）之后依然存续。

## 挂载发生在哪里

`ApiSessionAgentController.composeAgent()` 构造尚未发布 Agent 所运行的 `setup` 回调，并在 agent preset 挂载之后调用 `ctx.get('packMount')?.mount(agentCtx, cwd)`。由此得出三个结论：pack 层叠在 preset 之上；组装在该 Agent 第一次请求之前即固定；不挂载任何 pack 组合行的部署，其组装方式与此前完全一致——该可选读取返回 `undefined`，别的什么都不变。

## 磁盘上的一个 pack

本地提供方定义了目前唯一存在的布局。除清单外每一部分都是可选的，而清单的存在正是标记一个目录为 pack 的东西。

```text
viet-truyen/
  pack.yml     display text only; the id is the directory name
  rules/*.md   one prompt section each, in filename order
  skills/      an ordinary skill directory
```

`pack.yml` 只携带展示文本，别无其他——id 来自目录名，与 `preset.yml` 的做法完全一致，因此本地创作的 pack 无法冒领它没有写过的 id。无法解析的清单退化为空元数据而非隐藏该 pack，因为展示不是一种能力。

每种贡献都复用一个已经存在的插件，而不是新增第二套交付方式：rules 成为一行携带其文本的 `dsh-pack-rules`，skills 成为一行由 `providerName` 与 `includeDefaultRoots: false` 限定到该 pack 的 `dsh-skill-filesystem`。pack 的 `hooks/`、`commands/`、`agents/` 与 `mcp.json` 尚无加载器。

## 为什么 pack 的组合行是 Cordis 行

一个 pack 的内容是异质的——rules 是提示片段，skills 是目录条目，hooks 是 shell 进程，MCP server 是外部连接——而 harness 已经有一种能覆盖全部这些的表示：Cordis 插件行。因此 `PackRow` 参照 agent preset 的 `agent.cordis.yml` 条目，使得读取 pack 的 `hooks/`、`commands/` 或 `mcp.json` 的加载器所产出的行，正是现有挂载机制已经理解的行，无需引入新的挂载机制。

这之所以成立，是因为 agent 与 tool 事件是按 scope 分发的。挂载在有 scope 的组合内部的行，只会收到该 scope 内的 agent：`scopeTarget` 全局放行未打标签的监听器，放行标签位于被分发 agent 的 scope 链上的监听器，并排除其他所有标签（[`packages/core/scope/src/index.ts`](../../packages/core/scope/src/index.ts)）。事件沿 scope 链**向上**流动、从不向下，因此外层组合能观察到在其之下组合出的 agent，而同级组合什么也看不到。`packages/preset/agent-presets/tests/listener-scope.spec.ts` 是已执行的证明，覆盖 `agent/pre-step` 与 `tools/pre-execute` 两者。

## 身份

pack id 为 kebab-case（`^[a-z0-9]+(?:-[a-z0-9]+)*$`），与 skill 名文法一致，因为 id 同时会成为目录名。`PackId` 是[带 brand 的](../../packages/util/brand/README.zh.md)：它作为不透明键跨越注册表、绑定存储与每一个 wire 接口，且不得与 workspace id 或 skill 名互换。

## 注册表

`ctx.packs` 把提供方目录合并成一份排序清单，并按需加载胜出 pack 的组合行。它没有 scope 分层——pack 绑定到 workspace 而非 agent scope，因此注册集合是扁平的，单份缓存观测即可服务所有读取方。

同名 id 按 `rank`、再按提供方注册顺序、再按该提供方自身的列出顺序解析。只有胜出者进入目录，因此部署可以用自己的 pack 遮蔽同 id 的内置 pack，而不必移除内置来源。

发现的完整性是被报告的，而不是被隐藏的。当任一提供方失败或报告发现不完整时，`snapshot()` 返回 `complete: false`，且这样的观测从不被缓存，因此消费者能区分「确实为空的目录」与「不可达的来源」，并保留自己上一次的良好清单。

## 授权是提供方的职责

注册表刻意不含授权概念。提供方只列出当前安装可见的内容，因此未获授权的 pack 从不进入目录，其组合行也不会到达任何可能泄露它们的消费者。若改为在消费者中过滤，则意味着 pack 的内容早已越界进入了本不该持有它们的接口。

这也界定了打包所能保护的边界：文件位于用户自己机器上的 pack，无论目录报告什么，该用户都能读取。必须保持不可读的内容，属于凭令牌返回它的远程提供方。

## 包参考

- [`dsh-pack`](../../packages/pack/pack/README.zh.md) —— 注册表：注册、优先级、缓存、失败词汇与提供方契约。
- [`dsh-pack-local`](../../packages/pack/pack-local/README.zh.md) —— 本地提供方：清单、目录布局、根目录优先级与组合行生成。
- [`dsh-pack-rules`](../../packages/pack/pack-rules/README.zh.md) —— rules Consumer：片段命名、排序与提示位置。
- [`dsh-pack-binding`](../../packages/pack/pack-binding/README.zh.md) —— 绑定存储：路径规范、读写语义与持久性。
- [`dsh-pack-mount`](../../packages/pack/pack-mount/README.zh.md) —— 挂载步骤：行命名空间、scope 保证与激活审计。
