---
description: "持久化的「目录 → pack」绑定（ctx.packBindings）：某个 workspace 目录开启了哪些 pack、路径如何规范化、目录消失时读取返回什么。"
kind: "package-reference"
---

# @deepseek-ai/dsh-pack-binding

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-pack-binding` 记住某个项目目录开启了哪些 pack。它以目录的规范路径为键，通过 domain 数据形态为每个目录存一条记录，并为即将在该目录中组装会话的一方回答「这个目录跑什么」。它不存储 pack 自身的任何内容——只存该目录选中的 id——因此 pack 变化时绑定依然成立，而当前无提供方服务的 pack 只是暂时不贡献任何东西，直到它回来。任何提供 pack 的组合都可以挂载它；它是「为项目 A 添加插件 X」的持久化那一半。

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

把该服务挂载在一个存储后端与 domain 设施旁边；它自行打开自己的 domain，不需要别的东西。

### 何时选择它

当 pack 是按项目开启时选择它。当部署为每个会话都提供同一套固定 pack 时不必用它——那是一个组合，而按目录存储只会增加一次只有一个答案的查找。

### 最小配置

该插件没有配置项。

```yaml
- name: '@deepseek-ai/dsh-pack-binding'
```

### 读与写

`for(path)` 回答绑定到某个目录的 pack id，`set(path, packIds)` 替换该列表。`list()` 返回每个已绑定的目录，供管理界面使用。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { PackId } from '@deepseek-ai/dsh-pack'
import type {} from '@deepseek-ai/dsh-pack-binding'

declare const ctx: Context

await ctx.packBindings.set('/home/me/novel', [PackId('viet-truyen')])
await ctx.packBindings.for('/home/me/novel')  // ['viet-truyen']
```

`set` 是替换而非合并，重复项会折叠但保持顺序，空列表会移除记录——「绑定为空」与「从未绑定」是同一个状态，而不是两个。

### 为什么用路径而不是 workspace id

绑定以目录的规范路径为键，而不是以 `WorkspaceId` 为键，因为 workspace 注册表只随浏览器应用发布，而该目录中的会话可以被**每一个** profile 打开。以路径为键，使得在同一文件夹中运行的 headless 或 SDK 会从同一批 pack 组装出来，并且在项目被移出 workspace 列表又重新加入后依然存续。

规范化是对绝对路径做 `fs.realpath`，因此结尾斜杠、`..` 片段，以及指向该目录的符号链接都读到同一条记录。这与 `dsh-workspace` 对 workspace 路径所用的规范一致；两者必须保持一致，否则一个已注册的项目会把它的绑定存到与「在其中运行的会话」不同的字符串名下。

### 失败与恢复

对无法解析的目录——已删除，或从未创建——的读取返回空而不是失败：不存在的目录不可能持有绑定，会话创建也不应因为某个文件夹被移动而中断。对这样的路径写入则以底层文件系统错误拒绝，因为把 pack 绑定到不存在的目录是值得报告的调用方错误。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕 —— 点击展开</summary>

该服务是覆盖在自有存储 domain 中一张 `bindings` 表之上的一层薄的类型化外观。路径规范化之后，读取是针对 domain 内存表的同步读取；写入走 domain 的写链，因此对同一目录的并发更新绝不交错。domain 在服务 init 期间打开，并由一个 `ctx.effect` 释放器关闭，这使得组合重载时该 domain 名字可以被再次打开。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务本体：domain 生命周期、读取与写入 |
| [`src/spec.ts`](src/spec.ts) | 持久记录 schema 与 domain 声明 |
| [`src/paths.ts`](src/paths.ts) | 绑定身份所用的路径规范化 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-pack-mount](../pack-mount/README.zh.md) —— 读取绑定并据此组装 Agent 的消费者。
- [dsh-pack](../pack/README.zh.md) —— 所存 id 所指向的目录清单。
- [存储子系统](../../../docs/subsystems/storage.zh.md) —— 本服务据以持久化的 domain 数据形态。
- [Pack 子系统](../../../docs/subsystems/pack.zh.md) —— 绑定在 pack 各角色中的位置。

-----

<a id="model-experience"></a>
## 模型体验

### 已存储的绑定

#### 模型看到什么

什么都没有。`ctx.packBindings` 只向宿主侧消费者提供记录：本包不注册工具、不注入提示、不写会话事件。它所指名的那些 pack 贡献了什么，属于那些 pack 自己的契约，经由挂载步骤而非本存储抵达。

#### Token 影响

每次请求的直接 token 均为零。

#### KV 缓存影响

与实时请求无关：本包从不触及请求前缀，因此无法使提供方的缓存复用失效。改变一条绑定改变的是**之后**的会话组装出什么，任何前缀变化都出现在那里。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定本存储到此为止。它们是当前的包约束，不是任务清单。

- **只支持整表写入** —— 没有单条绑定或单条解绑操作，因此两个界面并发编辑同一目录时可能丢失一次编辑。一旦存在多个界面，操作集合将需要 revision 栅栏或逐 pack 写入。
- **目录被移动就会丢失绑定** —— 键是规范路径，因此重命名项目目录会静默解绑。没有任何东西检测该移动或提议把绑定带过去。
- **没有任何东西清理陈旧记录** —— 指向已不存在目录的绑定仍会被存储并出现在 `list()` 中；只有对它的读取才返回空。
- **不与目录清单做校验** —— 无提供方服务的 id 也可以被绑定。这是刻意的，好让被卸载的 pack 能够回来，但也意味着拼写错误会与真实 id 一样被存下来。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

此处的路径规范复制了 `dsh-workspace` 的 `realpathNormalize` 而非导入它：那个包只随浏览器应用发布，而本包必须在每个 profile 中工作。为该规范找一个共享的家会是更好的最终修法——`packages/util/*` 容纳不下它，因为那里是浏览器安全、不含 `fs` 的。

</details>

**运行时不变量：** 未发布伴生检查。所存的表是「某个目录绑定了什么」这一关系的唯一权威；不存在可与之分歧的独立观测。
