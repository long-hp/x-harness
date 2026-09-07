---
description: "pack Remote 命名空间：目录清单页所渲染的目录、项目页所写入的按目录绑定，以及目录消失时每个动词回答什么。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-pack-controller

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-pack-controller` 是「为项目 A 添加插件 X」背后的 Remote 界面。它在一个命名空间下提供两样东西：本安装可以看到的 pack 目录清单，以及每个项目目录开启了哪些 pack。它只负责 wire 层面的事——校验请求、把摘要投影成浏览器安全的视图、给拒绝分类——而「存在哪些 pack」由注册表决定，「本安装可以看到哪些」由各提供方决定。把它挂载在提供 pack 的 Host 组合中；浏览器页面、CLI 或任何其他 Remote 客户端便可以读写绑定，而不必触碰存储。

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

把该插件挂载在 Typert 注册表与 pack seam 旁边；它没有配置项。

### 何时选择它

当 Host 进程之外的客户端要开启和关闭 pack 时选择它。当部署从自己的组合中绑定 pack 时不必用它——固定的一套 pack 不需要按目录的界面，那个命名空间只会回答没有人提出的问题。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-api-pack-controller'
```

该控制器注入 `typert`、`packs` 与 `packBindings`。在三者齐备之前它保持 pending，而不是注册一个每个动词都会失败的命名空间：`dsh-base` 无条件组合 pack seam，因此 `pack` 命名空间缺席意味着那些组合行被移除了，而启动审计会报告这件事。

### 各个动词

| 动词 | 回答什么 |
|---|---|
| `catalog()` | 本安装可以看到的每个 pack，按展示顺序，外加本次发现是否具有权威性 |
| `bindings(directory)` | 某个目录开启了哪些 pack id |
| `bind(directory, packs)` | 替换该列表，并回答所存的那一份 |
| `boundDirectories()` | 每个已绑定 pack 的目录，供管理视图使用 |

`bind` 是替换而非合并，空列表会解绑该目录。它会存下当前无提供方服务的 id，好让被卸载的 pack 在其提供方回来时也回来；代价是拼写错误会与真实 id 一样被存下来。

### wire 上的目录身份

响应回显的是**调用方自己写的那个路径**，因此以「用户选中的路径」为键的页面不必在每次响应时重新换键。存储在内部以 `fs.realpath` 规范化，而 `boundDirectories()` 是唯一回答那些规范键的动词，因为管理视图列出的是所存内容，而不是某人问起的内容。

### 失败与恢复

对无法解析的目录——已删除，或从未创建——的读取返回空而不是失败，因为项目页面对一个被移动过的文件夹仍然必须能渲染。对这样的目录写入会以 `pack/unresolvable-directory` 拒绝，因为把 pack 绑定到不存在的目录是值得报告的调用方错误。格式错误的请求——空路径、id 不是列表——在抵达存储之前就以 `gateway/bad-request` 拒绝。

不完整的目录清单会被报告而非隐藏：`complete: false` 意味着某个提供方失败或报告了部分发现，读到它的客户端应保留自己上一次的良好清单，而不是把缺失的 pack 当作已卸载。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕 —— 点击展开</summary>

### 为什么 wire 视图比 seam 更窄

`PackSummary` 携带 `resourceBase`，对本地提供方而言那是一个绝对宿主路径。Gateway 返回业务结果时并不解码它，因此直接返回 seam 自己的对象会把那个路径——以及提供方附加的任何其他可枚举属性——序列化给浏览器。所以每个字段都按名字逐一复制进 `PackSummaryView`，这与 `dsh-api-settings-controller` 对 settings 描述符所做的防御相同。

这留下了一个未解析的图标：`icon` 按 pack 声明的原样传递，没有可供解析的基址，因此客户端目前还取不到图标。

### 授权不在此处

此处没有任何东西过滤目录清单。提供方列出当前安装可以看到的内容，因此未获授权的 pack 从不进入目录清单，也就无法抵达本控制器。改为在此处过滤，意味着该 pack 的内容早已越过了一个本不允许持有它的界面。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | Remote 服务本体：动词、请求准入与失败映射 |
| [`src/types.ts`](src/types.ts) | 浏览器安全的 wire 视图与失败词汇 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-pack](../../pack/pack/README.zh.md) —— 本命名空间所服务的那个目录清单的注册表。
- [dsh-pack-binding](../../pack/pack-binding/README.zh.md) —— 绑定动词背后的存储，以及它们继承的路径规范。
- [dsh-typert-protocol](../../typert/protocol/README.zh.md) —— `@Remote` 装饰器、`RemoteError`，以及命名空间如何抵达客户端。
- [Pack 子系统](../../../docs/subsystems/pack.zh.md) —— 本界面所位于其上的那个家族。

-----

<a id="model-experience"></a>
## 模型体验

### pack Remote 命名空间

#### 模型看到什么

什么都没有。本包只服务 Remote 客户端：它不注册工具、不注入提示、不写会话事件。`catalog()` 与 `bind(directory, packs)` 都不会抵达模型请求。已绑定的 pack 向模型贡献了什么，属于那个 pack 自己的契约，经由会话创建时的 `ctx.packMount` 而非本命名空间抵达。

#### Token 影响

每次请求的直接 token 均为零。

#### KV 缓存影响

间接且延后。一次 `bind` 调用改变的是**之后**的会话组装出什么；已在运行的会话保持它开始时的组合，因此绑定变化时没有任何实时请求前缀移动。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定本界面到此为止。它们是当前的包约束，不是任务清单。

- **不解析图标** —— `icon` 按 pack 声明的原样传递，而 `resourceBase` 被刻意扣下，因此客户端无从取得某个 pack 的图标。服务 pack 资源需要一条本包并不拥有的路由。
- **没有变更通知** —— 注册表的 `packs/change` 事件没有投影到该命名空间，因此客户端是轮询 `catalog()` 而不是跟随它。此处其他每个 Remote 界面都是一次调用回答一次；当实时目录清单页需要时，follow 流是下一步补充。
- **只支持整表写入** —— `bind` 是替换，与其下的存储一致，因此两个客户端并发编辑同一目录时可能丢失一次编辑。没有 revision 栅栏。
- **不与目录清单做校验** —— 无提供方服务的 id 也能绑定成功。这是刻意的，好让被卸载的 pack 能够回来，但拼写错误与暂时缺席的 pack 无法区分。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

本开发备注是非权威的工作上下文：尚未定案的方向与给维护者的提示。

- 基于 `packs/change` 的 follow 流是显而易见的下一步补充，可以复用 `dsh-api-workspace-controller` 已经实现的、对重连安全的帧模式。它尚未构建，是因为还没有客户端渲染实时的目录清单页。

</details>

**运行时不变量：** 未发布伴生检查。每个答案都在调用时从注册表与绑定存储推导而来；本包自身不保留任何可被第二种观测反驳的关系。
