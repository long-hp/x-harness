---
description: "用某个 workspace 目录已开启的 pack 组装一个 Agent（ctx.packMount）：组合行命名空间、scope 保证，以及缺失或损坏的 pack 对会话创建的影响。"
kind: "package-reference"
---

# @deepseek-ai/dsh-pack-mount

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-pack-mount` 是让 pack 绑定真正产生意义的那一步：给定一个 Agent 的 scope 与它的工作目录，它读取该目录开启了哪些 pack，加载它们的组合行，并**只**在那个 Agent 之下挂载它们。因此 pack 贡献的一切——提示片段、工具、skills、hooks、MCP server——只抵达那一个 workspace 的会话而不抵达其他，因为 harness 沿 scope 链分发 Agent 与工具事件。在提供 pack 的组合中挂载它；会话入口通过 `ctx.get('packMount')` 调用它，因此没有它的部署组装方式与此前完全一致。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把该插件挂载在 pack 注册表与绑定存储旁边。它发布 `ctx.packMount`；组合中别的东西都不需要改。

### 何时选择它

在任何「pack 应当真正运行」的组合中选择它。没有它，pack 可以被列出、被绑定，却永远不会组装进会话——对于只代另一个宿主管理 pack 的部署，这是合理姿态；在其他任何地方都是错的。

### 最小配置

该插件没有配置项。

```yaml
- name: '@deepseek-ai/dsh-pack-mount'
```

### 一次挂载做了什么

`mount(agentCtx, cwd)` 在尚未发布的 Agent 的 `setup` 中被调用，在该 Agent 发布之前、因而也在它第一次请求之前：

1. 读取绑定到 `cwd` 的 pack id。
2. 加载每个 pack 的组合行，跳过无提供方服务的 id。
3. 把每一行作为一棵 entry 树挂载到 `agentCtx` 之下。
4. 若任何启用的行未达到可用状态，拒绝整次挂载。

pack 在 agent preset 之后挂载，因此某个 workspace 的 pack 层叠在其 preset 所选的组合之上。

### scope 保证

向不带 scope 的上下文挂载会被拒绝，因为它的那些注册会作用于进程中的每一个 Agent。有了 scope，harness 自身的分发完成其余部分：pack 组合行注册的监听器只对该 scope 链上的 Agent 放行，而 pack 的工具与提示片段归入那个 Agent 的注册表层。这正是把一个项目的 pack 挡在另一个项目会话之外的机制。

### 跨 pack 的行身份

绑定到同一目录的两个 pack 可能各自发布一个叫 `rules` 的行。因此每一行都以 `<packId>.<rowId>` 挂载，使 Loader 永远看不到重复的 entry id，两个 pack 也都不必知道对方把自己的行叫什么。

### 失败与恢复

无提供方服务的已绑定 pack 会被记录并跳过：被卸载或未获授权的 pack 不应让某个 workspace 无法打开，绑定也保留着，好让该 pack 在其提供方回来时一同回来。行无法启动的 pack，或其启用行一直等待组合从未提供的服务的 pack，会使挂载失败并回滚整棵树——半组装的 Agent 会在缺少用户所开启行为的情况下运行，且不留下任何缺失的迹象。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕 —— 点击展开</summary>

### 内联 entry 树

`Include` 是 Loader 的文件支撑树，而 pack 的组合行是从可能根本没有文件系统的提供方那里到达内存的。因此 `PackTree` 是一个小的 `EntryTree` 子类：直接接收组合行、不写任何东西，并且——与 `Include` 不同——不重写其上下文的 `baseUrl`，因此行中的裸包名会从「宿主组合解析自身依赖的地方」解析出来。

`EntryTree` 的构造函数会把每一棵新树归档到最近的拥有者 Loader entry 的 `subtree` 槽位。若不处理，一次 Loader 遍历就会把某个 Agent 的 pack 组合行报告为应用自身的 entry，因此构造函数会收回该槽位。

### 激活审计

直接挂载的子树不在 `ctx.loader.entries()` 中，因此没有任何启动审计覆盖它。Loader 已经会拒绝模块或插件抛错的行；剩下的形态是「一个启用的行仍在等待它所注入的服务」，那会静默地僵在那里。`dsh-agent-presets` 对 preset 行应用同一条规则——两者是刻意的重复而非共享导入，因为那个包只随浏览器应用发布，而 pack 在每个 profile 中都要组装。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务本体：绑定查找、组合行收集、挂载与激活审计 |
| [`src/tree.ts`](src/tree.ts) | 一次挂载插入 Agent scope 的内联 entry 树 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-pack-binding](../pack-binding/README.zh.md) —— 本包读取以得知某目录开启了什么的存储。
- [dsh-pack](../pack/README.zh.md) —— 已绑定 id 据以解析的目录清单。
- [作用域注册](../../../docs/subsystems/scope.zh.md) —— 使已挂载 pack 只抵达一个 Agent 的分发规则。
- [`AgentPresets` 参考](../../../docs/subsystems/core.zh.md#ctxagentpresets--agentpresets) —— pack 层叠其上的按会话组合。
- [Pack 子系统](../../../docs/subsystems/pack.zh.md) —— 该家族以及围绕这一步的各个角色。

-----

<a id="model-experience"></a>
## 模型体验

### 一个已绑定 pack 的贡献

#### 模型看到什么

已挂载组合行所贡献的一切，以及本包自身的零贡献。pack 的 rules 经由 `dsh-pack-rules` 成为提示片段，它的 skills 经由 `dsh-skill-filesystem` 加入会话的 skill 目录，它的工具加入可见工具集——各自遵循自己那个包的契约。本包指派的 `<packId>.<rowId>` 名字是 Loader entry id，绝不是模型可见文本；绑定、行命名空间与激活审计全都留在请求之外。

#### Token 影响

直接层面为零；已挂载的组合行承担开销，作用于该 Agent scope 内的每一次请求，贯穿会话生命周期。绑定了多个 pack 的目录要为它们全部付费。

#### KV 缓存影响

在一个 Agent 的生命周期内固定。挂载只发生一次，在该 Agent 发布之前、因而也在它第一次请求之前，因此 pack 的贡献确立该 Agent 的前缀，而不是在对话中途改变它。位于不同绑定目录中的两个 Agent 确立不同的前缀；彼此都无法使对方的复用失效。改变绑定或 pack 内容，影响的是此后组装的会话。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定这一步到此为止。它们是当前的包约束，不是任务清单。

- **没有服务泄漏检查** —— 把服务发布到根 realm 的 pack 组合行会成为进程全局而非按会话，第二个挂载该 pack 的目录会与第一个冲突。`dsh-agent-presets` 对 preset 行会拒绝这种情况；此处尚未实现等价审计，因此携带这类行的 pack 会在第二个 workspace 处令人困惑地失败，而不是在第一个处清晰地失败。
- **组装在会话创建时即固定** —— 绑定在 `setup` 中只读取一次。开启或关闭一个 pack 影响的是此后创建的会话，正在运行的会话保持它开始时的组装。
- **被跳过的 pack 只被记录** —— 无提供方服务的已绑定 pack 不留下任何界面可展示的持久记录，因此用户看到一个被列为已绑定的 pack，却没有任何东西解释它为何什么也没做。
- **行顺序即绑定顺序** —— pack 按绑定列表所存的顺序挂载，pack 内部的行按提供方顺序挂载。没有任何机制让一个 pack 声明它必须排在另一个之后。
- **没有经由真实包名的端到端覆盖** —— 挂载、组合行形状与 scope 保证各自都有覆盖，但尚无测试启动一个已构建的 profile、在其中让 pack 生成的组合行按名字解析 `@deepseek-ai/dsh-pack-rules` 与 `@deepseek-ai/dsh-skill-filesystem`。那一环属于 profile 级组合测试层。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

本开发备注是非权威的工作上下文：尚未定案的方向与给维护者的提示。

- 服务泄漏审计与激活审计在 `dsh-agent-presets` 中几乎以同样的形态存在。把它们抽取到一个共享的家可以消除本包所接受的重复；障碍在于 `agent-presets` 只随浏览器应用发布，因此那个共享的家不能是它。

</details>

**运行时不变量：** 未发布伴生检查。已挂载的树由 Agent 的 fiber 拥有并随之解绕；本包自身不保留任何可被第二种观测反驳的关系。
