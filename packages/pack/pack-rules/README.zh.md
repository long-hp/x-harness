---
description: "把一个 pack 的指令 rules 落为按 scope 生效的提示片段，面向组装 pack 或排查 pack 指引如何抵达模型的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-pack-rules

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-pack-rules` 把一个 pack 的指令 rules 放进该 pack 所绑定会话的系统提示中。pack 提供方读取它自己拥有的任意 rule 格式，并产出一行本插件的组合行来携带 rule 文本；挂载该行会把每条 rule 注册为**仅在挂载 scope 内**的提示片段，因此为某个项目写的 rule 绝不会抵达另一个项目。rules 以文本而非文件路径传递，因为一个 pack 可能来自远程提供方，挂载进程没有可读的文件系统。通常你不需要手写本插件的配置——pack 提供方会生成它的行——但配置足够简单，当某个组合只想要固定指引而不需要 pack 时也可以直接写。

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

把该行挂载到其会话应当看到这些 rules 的 scope 内。pack 提供方会替你产出这一行；下面的形状正是它产出的内容。

### 何时选择它

当需要由多条各自独立存续的组合 rules 共同贡献指引时，选择它。当某个组合要替换**Agent 是谁**时，改用 [`dsh-persona`](../../preset/persona/README.zh.md)——persona 每个 scope 只有一条，第二条会冲突，而本插件可以贡献配置中列出的任意多条具名片段。当指引位于用户自己项目中的 `AGENTS.md` 或 `CLAUDE.md` 时，改用 [`dsh-agent-instructions`](../../context/agent-instructions/README.zh.md)；该包在会话工作目录下发现文件，而这恰恰不是 pack 的 rules 所在之处。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-pack-rules'
  config:
    sections:
      - name: 'pack:viet-truyen:voice'
        text: 'Write in close third person.'
      - name: 'pack:viet-truyen:length'
        text: 'Chapters run 2000-3000 words.'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `sections` | `[]` | 本行贡献的 rules，按其应出现的顺序 |
| `sections[].name` | 必填 | 提示片段名，在挂载 scope 内唯一 |
| `sections[].text` | 必填 | rule 正文；文本为空时该片段在渲染时被丢弃 |
| `sections[].order` | `PACK_RULES` 槽位 | 在提示片段中的位置 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-pack-rules)是所有可接受字段的穷尽来源。

### rules 落在提示的什么位置

省略 `order` 时使用中央的 `PACK_RULES` 位置：在部署 persona 之后，在 plan policy 与所有工具片段之前。这把「某个项目的工作方式」置于「它所用工具的机制」之上，也正是阅读已组装提示的人所预期的顺序。

### 命名与冲突

片段名在一个 scope 内唯一，重复会在片段注册表处抛错，使该行挂载失败。这是刻意的：悄悄丢弃第二条 rule 会让用户以为某条指引生效，而实际上并没有。因此 pack 提供方会用 rule 来源的 pack id 限定每个名字——`pack:<id>:<rule>`——使绑定到同一 workspace 的两个 pack 不可能冲突。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕 —— 点击展开</summary>

本插件就是对其配置的一次遍历：每个条目成为一次由 `ctx.effect` 拥有的 `ctx.systemPrompt.section()` 注册，因此卸载该行会精确撤回它添加的那些片段。回退 order 在 apply 时读取一次而非逐片段读取，因为该行挂载期间中央槽位不会变化。

这里没有文件读取、没有监听、没有解析。pack 的 rules 需要从磁盘取得的一切，都已在产出这一行的提供方中完成。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件全部内容：配置 schema 与片段注册 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-pack-local](../pack-local/README.zh.md) —— 从 pack 的 `rules/` 目录生成本行的提供方。
- [Pack 子系统](../../../docs/subsystems/pack.zh.md) —— 本行在 pack 各项贡献中的位置。
- [系统提示子系统](../../../docs/subsystems/system-prompt.zh.md) —— 片段排序、scope 与组装。
- [dsh-persona](../../preset/persona/README.zh.md) —— 本插件刻意不去充当的「每 scope 一条」身份片段。

-----

<a id="model-experience"></a>
## 模型体验

### pack rule 片段

#### 模型看到什么

每条配置的 rule 作为独立片段出现在已组装的系统提示中，位于其 `order` 位置，内容正是提供方给出的 rule 文本。片段名是结构性的，不会展示给模型；只有文本会。文本为空的 rule 在渲染时不贡献片段。

#### Token 影响

每条已挂载的 rule 都会把其全文加入该 scope 内的**每一次**请求，贯穿会话生命周期。因此绑定到某 workspace 的 pack 在每次请求上都花费其 rules 的 token，而不是只花费一次。本插件不截断 rules；提供方在产出该行之前自行决定其上限。

#### KV 缓存影响

rules 位于稳定的系统提示前缀中，因此有利而非有害于复用：跨请求相同的 rules 使前缀保持一致。绑定或解绑一个 pack、编辑某个 rule 文件、或重排 rules 都会重写该前缀，并使复用从第一个变更片段起终止——这也正是 rule 变更只对此后创建的会话生效、而非在对话中途生效的原因。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定本行到此为止。它们是当前的包约束，不是任务清单。

- **rules 在挂载时即固定** —— 该行携带文本，因此磁盘上被编辑的 rule 只会抵达编辑之后组装的会话。这里没有监听器也没有刷新路径；想要实时 rules 的提供方需要另一种贡献形态。
- **没有模板变量** —— 文本按原样注册。与 persona 不同，它不插值 `{{model}}` 或 `{{cwd}}`，因此 rule 无法称呼它所落入的那个会话。
- **一个重名会使整行失败** —— 一个冲突的片段名会阻止该行中**每一条** rule 的挂载，而不只是那条重复的。这是响亮而非局部的失败，但提供方产出一个坏名字时，会连带失去该 pack 其余的全部指引。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

无。

</details>

**运行时不变量：** 未发布伴生检查。本插件不拥有任何可被第二种观测反驳的关系；其片段由提示注册表持有，注册表就是它们的唯一权威。
