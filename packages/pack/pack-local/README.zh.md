---
description: "从本地目录提供 pack：pack.yml 清单、rules/ 与 skills/ 布局、根目录优先级，以及一个 pack 所产出的组合行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-pack-local

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-pack-local` 让本机上的一个目录成为用户可以为某个项目开启的 pack。把它指向一个或多个根目录；每个持有 `pack.yml` 的子目录都会成为被列出的 pack，其 id 取自目录名，其展示文本取自清单。当一个 pack 被加载时，本包把它的 `rules/*.md` 与 `skills/` 内容转成已绑定会话所挂载的组合行，复用既有的 rule 与 skill 插件，而不是为两者各自发明第二套交付方式。你想要区分的每个来源挂载一个实例——例如内置 pack 与用户自己的 pack——因为提供方名字与根目录优先级都是按实例设置的。

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

把该插件挂载在 [`dsh-pack`](../pack/README.zh.md) 旁边，并给它要扫描的目录。

### 何时选择它

当 pack 位于运行 harness 的这台机器上时选择它——仓库自己的 pack 目录、团队共享目录，或用户的个人目录。当 pack 的内容必须对使用者不可读时，它是错误的选择：位于此人磁盘上的目录，无论任何目录清单如何报告，此人都能读取，因此受控内容属于凭令牌返回它的提供方。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-pack-local'
  config:
    roots:
      - path: ~/.dsh/packs
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `roots` | `[]` | 按优先级排列的被扫描目录；开头的 `~` 会展开 |
| `roots[].path` | 必填 | 持有各 pack 目录的目录 |
| `roots[].rank` | `300` | 该根目录 pack 的优先级；较小者赢得同名 id |
| `providerName` | `local` | 在 `ctx.packs` 中的提供方名字；每个挂载实例各不相同 |
| `maxRuleBytes` | `65536` | 单个 rule 文件的字节上限；超出者被跳过 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-pack-local)是所有可接受字段的穷尽来源。

### 磁盘上的一个 pack

```text
~/.dsh/packs/
  viet-truyen/
    pack.yml              display text; its presence is what makes this a pack
    rules/
      1-voice.md          one prompt section each, in filename order
      2-length.md
    skills/
      outline/SKILL.md    an ordinary skill directory
```

id 是目录名——上例中的 `viet-truyen`——而绝不是 `pack.yml` 内的某个字段，因此本地创作的 pack 无法冒领它没有写过的 id。名字不是 kebab-case 的目录会被跳过，不持有 `pack.yml` 的目录同样如此。

`pack.yml` 的每个字段都是可选的：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `name` | pack id | 展示名 |
| `description` | 空 | 名字下方展示的一句话 |
| `category` | `general` | 分组标签 |
| `version` | `0.0.0` | 供支持用的版本 |
| `order` | 发现顺序位置 | 展示位置；较小者靠前 |
| `icon` | 不存在 | 相对 pack 目录的路径 |

无法解析的清单，或持有标量而非映射的清单，产出空元数据而不是隐藏该 pack：展示不是一种能力，名字损坏的 pack 仍然携带可用的 rules 与 skills。类型错误的字段出于同样理由被逐个忽略。

### 一个 pack 会变成什么

| pack 内容 | 组合行 |
|---|---|
| `rules/*.md` | 一行 [`dsh-pack-rules`](../pack-rules/README.zh.md)，其片段携带每个文件的文本，命名为 `pack:<id>:<文件名>` |
| `skills/`（非空） | 一行 [`dsh-skill-filesystem`](../../skill/skill-filesystem/README.zh.md) 指向该目录，附带 `includeDefaultRoots: false` 与 `providerName: pack:<id>` |

rules 在 skills 之前。只读取 `rules/` 直接子级的 `.md` 文件——不递归——超过 `maxRuleBytes` 的文件被跳过而非截断，因为半条指令比没有指令更糟。两者都不携带的 pack 仍会被列出：一旦它有了内容，绑定它就是有意义的操作。

挂载已绑定 pack 的组合还必须能解析到 `dsh-pack-rules` 与 `dsh-skill-filesystem`，因为它们正是所生成组合行携带的模块名。

### 跨根目录的优先级

根目录按配置顺序扫描，每个 pack 取其根目录的 `rank`。两个根目录发布同一 id 时先按 rank 解析，因此在靠后的根目录上显式设置更小的 rank 可以让它胜出；rank 相同时靠前的根目录胜出，因为注册表以「提供方列出其 pack 的顺序」打破平局。

### 失败与恢复

不存在的根目录产出零个 pack，且仍算作一次完成的扫描——部署可能在创建个人 pack 目录之前就先配置了它。任何其他读取失败都会记录该根目录并使发现不完整，因此不可读的根目录绝不会被读成「此根目录没有 pack」，界面也可以保留自己上一次的良好清单。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕 —— 点击展开</summary>

### 设计理念

每种贡献都复用一个已经存在的插件。这正是 rules 成为一行 `dsh-pack-rules` 而不是在此处直接做提示注册的原因，也是 skills 成为一行 `dsh-skill-filesystem` 而不是第二套发现实现的原因：skill 提供方早已拥有 frontmatter 解析、监听与优先级，而它的 `providerName` 与 `includeDefaultRoots` 字段足以把一个实例限定到一个 pack，无需改动那个包。

rules 携带文本而非路径，使同一个 `PackDefinition` 形状对没有文件系统的提供方同样成立。该决定属于 seam 而非本包；在这里它只意味着 rule 文件在 `get()` 期间被读取，而不是在其中被命名。

发现不做记忆化。`list()` 在每次注册表未命中时重扫其根目录，而注册表自身的缓存正是防止这件事逐次读取发生的东西。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置、根目录解析、候选投影、提供方注册 |
| [`src/discovery.ts`](src/discovery.ts) | 根目录扫描与 `pack.yml` 读取 |
| [`src/rows.ts`](src/rows.ts) | 把一个 pack 目录的内容转成组合行 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-pack](../pack/README.zh.md) —— 本提供方注册到的注册表，以及它参与的优先级规则。
- [dsh-pack-rules](../pack-rules/README.zh.md) —— pack 的 `rules/` 所变成的那一行。
- [dsh-skill-filesystem](../../skill/skill-filesystem/README.zh.md) —— pack 的 `skills/` 所变成的那一行。
- [Pack 子系统](../../../docs/subsystems/pack.zh.md) —— 该家族以及围绕本提供方的各个角色。

-----

<a id="model-experience"></a>
## 模型体验

### pack 内容抵达一个会话

#### 模型看到什么

直接层面什么都没有。本包产出组合行；已挂载的行贡献了什么，属于那一行自己的契约——`dsh-pack-rules` 负责 pack 的 rules 所成为的提示片段，`dsh-skill-filesystem` 负责其目录所发布的 skills。发现过程、清单与根目录优先级从不抵达请求。

#### Token 影响

直接层面为零。本包产出的组合行承担开销：rules 把其文本加入被绑定 scope 内的每次请求，skills 把其名字与描述加入该会话的 skill 目录。

#### KV 缓存影响

间接，且每次会话组装时一次性发生。改变某个 workspace 绑定哪些 pack，或编辑某个 pack 的内容，会改变此后会话所挂载的组合行、进而改变其提示前缀；已在运行的会话不受影响，因为它的组合行在它被组装时就已读取完毕。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定本提供方到此为止。它们是当前的包约束，不是任务清单。

- **没有监听** —— 新增、编辑或删除一个 pack 目录不会使注册表的目录失效。界面只有在别的东西使其失效之后才会看到变化，因此目前创作一个 pack 需要重启才能出现。
- **只读取 rules 与 skills** —— pack 的 `hooks/`、`commands/`、`agents/` 与 `mcp.json` 被忽略：那些加载器尚不存在，因此把它们放进 pack 会悄无声息地不产生任何贡献。
- **`rules/` 下不递归** —— 只读取该目录直接子级的 `.md` 文件；嵌套的 rules 文件夹不可见，也没有任何诊断。
- **超限的 rule 文件被静默丢弃** —— 它被跳过而非截断，但没有任何东西告诉用户是哪个文件超过了 `maxRuleBytes`。
- **丢失清单的 pack 会消失** —— `pack.yml` 是标志，因此删除它会使该 pack 不再被列出，而不是报告一个丢失了元数据的 pack。
- **没有任何东西验证所生成的行模块可解析** —— 缺少 `dsh-pack-rules` 或 `dsh-skill-filesystem` 的组合会在已绑定 pack 挂载时失败，而不是在其 pack 于此处被列出时失败。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

本开发备注是非权威的工作上下文：尚未定案的方向与给维护者的提示。

- 监听是显而易见的下一步补充，而 `PackProviderControl.invalidate()` 正是为它而存在。它尚未构建，是因为绑定与挂载这两个角色会先落地：在一个 pack 能被开启之前，实时目录变化没有可抵达的界面。

</details>

**运行时不变量：** 未发布伴生检查。提供方在读取时从文件系统推导出每个答案，自身不保留任何可被第二种观测反驳的关系。
