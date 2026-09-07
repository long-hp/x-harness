---
description: "Pack 提供方注册表（ctx.packs）：合并任意提供方的 pack 目录、解析同名 id 的胜出者、按需加载其组合行，面向组合或扩展 pack 来源的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-pack

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-pack` 是每个 pack 来源共同汇入的注册表：提供方发布可安装行为包的目录——一个 pack 的 rules、skills、hooks、commands、subagents 与 MCP server——本服务把这些目录合并成一份排序后的清单，决定同一 id 由哪个提供方胜出，并按需加载胜出 pack 的组合行。当部署要向用户提供可为某个项目开启的 pack 时挂载它，并同时挂载至少一个提供方；没有提供方时它只提供空目录，不产生任何开销。它不读取文件、不认识任何打包格式，因此提供方可以自行拥有目录结构、npm 包或需授权的远程服务。授权是提供方的职责而非注册表的职责：提供方只列出该安装可见的内容，因此未获授权的 pack 从不进入目录，其组合行也不会到达任何消费者。

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

挂载该服务，在其旁挂载一个或多个提供方，然后通过 `ctx.packs` 读取目录。

### 何时选择它

当部署要提供用户为项目开启的 pack，且需要有东西把多个 pack 来源合并成一份清单时，选择它。当部署对每个会话都只使用一套固定插件时不必用它——组合文件本身已经表达了这件事，中间不需要注册表。本包只承担 Service Definition 角色：它不注册工具、不提供 wire 接口、不向 Agent 挂载任何东西，因此在提供方与消费者加入之前，它没有任何可观察行为。

### 最小配置

该插件没有配置项；此处没有随部署变化的内容。

```yaml
- name: '@deepseek-ai/dsh-pack'
```

### 注册一个提供方

提供方插件在 `apply()` 期间同步注册。工厂函数收到一个 control，其 `signal` 在注册被释放时中止，其 `invalidate()` 在提供方自身来源变化后丢弃已缓存的目录。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { PackId } from '@deepseek-ai/dsh-pack'

export const name = 'my-pack-source'
export const inject = ['packs']

export function apply(ctx: Context) {
  ctx.packs.registerProvider(control => ({
    name: 'my-pack-source',
    list: () => Promise.resolve([{
      id: PackId('viet-truyen'),
      name: 'Viết truyện',
      description: 'Long-form fiction drafting.',
      category: 'writing',
      version: '1.0.0',
      order: 1,
      provider: 'my-pack-source',
      rank: 100,
      locator: { /* whatever this provider needs to load the pack later */ },
    }]),
    get: candidate => Promise.resolve({ ...candidate, rows: [] }),
  }))
}
```

以已注册的名字注册第二个提供方会抛错，因此把同一来源挂载两次的组合会在加载时失败，而不是悄悄提供一份重复的目录。

### 读取目录

`list()` 返回胜出的摘要，按 `order` 再按 id 排序。`snapshot()` 返回同样的清单，外加「是否每个提供方都完成了发现」，因此界面能区分「确实为空的目录」与「某个来源暂时不可达」。`get(id)` 加载胜出 pack 的组合行。

pack id 为 kebab-case（`^[a-z0-9]+(?:-[a-z0-9]+)*$`），因为 id 同时会成为目录名；`isPackId()` 是导出的校验函数，而 `get()` 在触及任何提供方之前就会拒绝不合规的 id。

### 同名 id 与优先级

两个提供方可以发布同一个 pack id。`rank` 最小者胜出；rank 相同则按提供方注册顺序，再按该提供方自身的列出顺序。只有胜出者进入目录、只有胜出者会被加载，因此部署可以用自己的 pack 遮蔽同 id 的内置 pack，而不必移除内置来源。

### 失败与恢复

`list()` 拒绝的提供方会被记录并跳过：目录保留其他所有提供方的 pack，并报告 `complete: false`。返回值既不是候选数组也不是 `{ candidates, complete }` 观测的提供方会使该次读取失败；缺少 id、name、description、category 或 version，携带非有限 `order` 或 `rank`，或声称自己属于其他提供方名字的候选同样如此——畸形候选在仍能指名其产出提供方的位置被拒绝，而不是作为空白条目抵达界面。调用方的 `signal` 可以中止列举，即使某个无响应的提供方仍在工作。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕 —— 点击展开</summary>

本节解释注册表背后的设计；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 设计理念

注册表只拥有三件事，别无其他：有哪些提供方、同一 id 由哪个候选胜出、以及一份缓存目录。它刻意不做 scope 分层——与 `ctx.skills` 不同，pack 绑定到 workspace 而非按 agent scope 贡献，因此注册集合是扁平的，单份缓存观测即可服务所有读取方。

缓存以单调递增的 revision 为键，而非以时间为键。每次注册、释放与提供方 `invalidate()` 都会推进 revision、丢弃缓存并发出 `packs/change`；只有当发现完成**且**在等待提供方期间 revision 未移动时，快照才会被存储，因此读取中途发生变化的目录永远不会被缓存到更新的 revision 名下。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务本体：注册、目录合并、优先级、缓存与变更通知 |
| [`src/types.ts`](src/types.ts) | 每个 pack 接口共享的词汇——身份、展示元数据、组合行与提供方契约 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

这些页面从本包定义的 seam 走向 pack 组合行最终抵达的组合机制。

- [Pack 子系统](../../../docs/subsystems/pack.zh.md) —— 该家族的词汇以及围绕本注册表的各个角色。
- [dsh-skill](../../skill/skill/README.zh.md) —— 本注册表所参照的注册表，也是 pack 中 skills 最终抵达的 seam。
- [dsh-agent-presets](../../preset/agent-presets/README.zh.md) —— `PackRow` 行文法所参照的按会话组合机制。
- [能力 seam](../../../docs/capability-seams.zh.md) —— 本家族遵循的 Service Definition / Service Provider / Consumer 划分。

-----

<a id="model-experience"></a>
## 模型体验

### Pack 目录与组合行

#### 模型看到什么

什么都没有。`ctx.packs` 只向宿主侧消费者提供目录与组合行：本包不注册工具、不注入提示、不写会话事件，因此没有任何请求字段承载本包的数据。已挂载 pack 自身的组合行贡献了什么，属于那些行的契约，而非本注册表的契约。

#### Token 影响

每次请求的直接 token 均为零。

#### KV 缓存影响

与实时请求无关：本包从不触及请求前缀，因此无法使提供方的缓存复用失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定本注册表到此为止。它们是当前的包约束，不是任务清单。

- **该 seam 尚无提供方与消费者** —— 仅本包自身列不出任何内容、也挂载不了任何东西。发现 pack 的来源、把 pack 绑定到 workspace 的存储、以及挂载已绑定 pack 组合行的组合步骤，都是尚不存在的独立包，因此只挂载这一行的部署不会获得任何行为。
- **没有任何东西校验 pack 的组合行** —— `PackRow` 从提供方原样传递给挂载方。命名了无法解析模块的行会在挂载时、在消费者中失败，而不是在此处列举时失败。
- **缓存是全有或全无的** —— 任一提供方的 `invalidate()` 会丢弃整份目录，下次读取时每个提供方都会被重新询问。以本 seam 面向的少量提供方而言，这比逐提供方记账更便宜；但拥有许多慢速远程来源的部署会感受到差异。
- **不完整的观测从不被缓存** —— 持续失败的提供方会使每次读取都重新询问所有提供方。此处没有退避策略，因此轮询的消费者自行决定重试频率。
- **优先级不会被报告** —— 目录只显示胜出者。界面无法告诉用户他们的 pack 遮蔽了同 id 的内置 pack，因为落败候选在合并期间就被丢弃了。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

本开发备注是非权威的工作上下文：尚未定案的方向与给维护者的提示。已落地行为与已接受的理由位于上文各节与包代码中。

- `PackDefinition` 应内联携带组合行还是携带一个组合文件路径，目前定为携带组合行，因为远程提供方无法交回一个路径。已经拥有真实组合文件的文件系统提供方将不得不从中物化出组合行；若这被证明有损，该定义可能需要同时携带两者。

</details>

**运行时不变量：** 未发布伴生检查。注册表是「有哪些提供方、同一 id 由哪个候选胜出」这一关系的唯一权威；不存在可与之分歧的独立观测。
