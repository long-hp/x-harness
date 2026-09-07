---
description: "pack 分组地图：可安装的 Agent 行为包——rules、skills、hooks、commands、subagents 与 MCP server——由用户为某个项目开启，面向浏览本分组的用户与维护者。"
kind: "package-group"
---

# packages/pack

[English](README.md) | 中文

## 概述

pack 分组提供 pack：具名的 Agent 行为包，由用户为**某个项目**开启，而非为某次会话开启。一个 pack 携带某个项目工作方式所需的一切——指令 rules、skills、hooks、commands、subagents 与 MCP server——绑定了 pack 的 workspace 会把该 pack 的贡献组合进它的每一个新会话。本分组的存在，是为了让这些行为包无论来自何处——目录、npm 包，还是需授权的远程服务——都拥有同一套身份、同一份目录与同一条优先级规则。本页是分组地图；各包 README 拥有各自的契约。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx key |
|---|---|---|
| [`pack`](pack/README.zh.md) | 合并任意提供方的 pack 目录，并加载胜出 pack 组合行的注册表 | `ctx.packs` |
| [`pack-local`](pack-local/README.zh.md) | 从本地目录提供 pack，读取每个 pack 的清单、rules 与 skills | 注册到 `ctx.packs` |
| [`pack-rules`](pack-rules/README.zh.md) | 把一个 pack 的指令 rules 落为其挂载 scope 内的提示片段 | — |
| [`pack-binding`](pack-binding/README.zh.md) | 记住某个项目目录开启了哪些 pack | `ctx.packBindings` |
| [`pack-mount`](pack-mount/README.zh.md) | 用某个目录已开启的 pack 组装一个 Agent | `ctx.packMount` |

-----

<a id="related-documentation"></a>
## 相关文档

- [Pack 子系统](../../docs/subsystems/pack.zh.md) —— 本分组的词汇、围绕注册表的各个角色，以及每个角色拥有什么。
- [Skill 子系统](../../docs/subsystems/skills.zh.md) —— pack 中 skills 最终抵达的 seam，也是本分组注册表所参照的注册表。
- [`AgentPresets` 参考](../../docs/subsystems/core.zh.md#ctxagentpresets--agentpresets) —— pack 组合行所加入的按会话组合机制。
- [能力 seam](../../docs/capability-seams.zh.md) —— 本分组遵循的 Service Definition / Service Provider / Consumer 划分。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

该家族运行所需的每个角色都已就位：注册表、本地提供方、rules Consumer、绑定存储，以及会话入口调用的挂载步骤。缺的是界面——目前只有直接调用 API 才能为项目开启一个 pack——以及 pack 的 hooks、commands、subagents 与 MCP server 的加载器。

</details>
