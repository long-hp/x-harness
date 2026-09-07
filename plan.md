# Kế hoạch tuỳ biến DeepSeek Harness

Tài liệu phân tích khoảng cách (gap analysis) cho 3 yêu cầu:
1. Dùng nhiều model thay vì chỉ DeepSeek
2. Tận dụng ChatGPT / Gemini "free" làm LLM
3. Hệ thống **Plugins** kiểu Claude Code — mỗi plugin là một gói gồm **rules + skills + hooks** (+ commands, subagents, MCP), gắn được vào từng dự án: thêm thư mục dự án A → gán plugin X → dự án đó chạy theo hệ thống đó

> File này là bản nháp kế hoạch ở thư mục gốc, **không** nằm trong phạm vi các doc gate (`doc-standard.spec.ts` chỉ quét `packages/*/README.md` và `docs/`; `verify-doc-budgets` dùng manifest liệt kê tường minh), nên không cần bản song ngữ. Khi chốt phương án, phần kiến trúc nên chuyển thành Agent Note trong `.agents/notes/`.

-----

## 0. Tóm tắt: cái gì đã có, cái gì phải làm

| Yêu cầu | Trạng thái | Khối lượng |
|---|---|---|
| Nhiều model provider (OpenAI, Anthropic, gateway tự host, OpenRouter, Ollama…) | ✅ **Đã có sẵn, chỉ cần cấu hình** | 0 code |
| Gỡ mặc định DeepSeek (default model, branding, onboarding) | ⚠️ Có nhưng phải sửa composition | Nhỏ |
| Gemini qua API free tier | ✅ Chạy được ngay bằng custom provider | 0 code |
| ChatGPT (gói Plus/Pro) qua Codex OAuth | ⚠️ Backend đã có, **chưa mount, chưa có Remote, chưa có UI** | Trung bình |
| Lái trực tiếp ChatGPT/Gemini web UI | ❌ Chưa có + vi phạm ToS + rất dễ vỡ | Lớn, rủi ro cao |
| **Rules** (`AGENTS.md`, prompt section, persona) | ✅ Đã có, đã per-project | 0 code |
| **Skills** (`.md` + scripts, `/name`) | ✅ Đã có đầy đủ, đã per-project | 0 code |
| **Hooks** (format Claude Code `hooks.json`) | ✅ **XONG** — bridge đúng dialect, và pack mount nó theo từng thư mục dự án | 0 code |
| **Commands** kiểu `commands/*.md` | ⚠️ Có `/name` của skill (~80%); `ctx.commands` là code, không phải `.md` | Nhỏ–Trung bình |
| **Subagents** kiểu `agents/*.md` | ⚠️ Có `tool-subagent` với `persona`/`toolFilter`/`agentOptions` nhưng khai bằng cordis config, không phải `.md` | Trung bình |
| **MCP servers** kiểu `.mcp.json` | ⚠️ Có `mcp-client` (1 row/server), chưa đọc được `.mcp.json` | Nhỏ |
| **Gói tất cả thành 1 "plugin" có manifest** | ❌ Chưa có | Trung bình |
| **Gắn plugin vào 1 workspace/dự án** | ✅ **XONG** — `pack-binding` + `pack-mount`, khoá theo đường dẫn chuẩn hoá | 0 code |
| Màn hình quản lý/bật-tắt plugin trong app | ❌ Chưa có (mới có settings section cho preset) | Trung bình |
| Tài khoản / entitlement / khoá plugin theo gói | ❌ **Hoàn toàn chưa có** | Lớn |
| "Chỉ mình tôi tạo được plugin" | ❌ Chưa có | Trung bình |

**Phát hiện quan trọng nhất:** cơ chế để "plugin X chỉ áp dụng cho dự án A" **đã tồn tại sẵn trong harness**, chỉ là chưa ai gói lại thành sản phẩm. Chi tiết ở mục 3.3 — đây là thứ quyết định việc này khả thi ở mức trung bình chứ không phải phải viết lại lõi.

-----

## 1. Model: dùng nhiều provider

### 1.1 Cái đã có

Harness **đã là multi-provider**. Adapter `@deepseek-ai/dsh-llm-pi-ai` được mount sẵn trong bundle nền ở trạng thái "ngủ":

- `packages/bundle/base/cordis.patch.yml:100-108` — mount dormant, 0 route, chỉ bật khi `settings.yaml` có section `llm-pi-ai:`
- `packages/llm/llm-pi-ai/README.md` — mỗi route kế thừa endpoint/protocol/catalog từ pi-ai, hoặc khai báo tay hoàn toàn
- `packages/llm/llm-pi-ai/src/provider.ts:47-52` — 3 wire protocol cho route khai tay: `openai-completions`, `openai-responses`, `anthropic-messages`
- `packages/llm/llm-pi-ai/src/catalog.ts` — dùng `builtinProviders` của pi-ai (có `openrouter`, `openai-codex`, `google-vertex`, `azure-openai-responses`…)

Kèm theo là toàn bộ UI:

- `packages/client/ui-settings-models/` — trang **Settings → Models**: thêm provider có sẵn, thêm custom provider, **Fetch available models** hỏi endpoint, API key lưu write-only vào `$DSH_HOME/.credentials.yaml`
- `packages/client/ui-model-selection/` — model picker trong hội thoại
- `packages/llm/llm-retry/`, `packages/llm/token-meter/` — retry theo policy từng provider, đo áp lực context
- Đổi `settings.yaml` có hiệu lực **ngay ở request kế tiếp**, không restart

Ví dụ `$DSH_HOME/settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    openrouter:
      apiKeyEnv: OPENROUTER_API_KEY
    gemini:
      displayName: Gemini (AI Studio)
      api: openai-completions
      baseURL: https://generativelanguage.googleapis.com/v1beta/openai/
      apiKeyEnv: GEMINI_API_KEY
      models:
        - id: gemini-2.5-flash
          contextWindow: 1048576
          input: [text, image]
    ollama:
      displayName: Local (Ollama)
      api: openai-completions
      baseURL: http://127.0.0.1:11434/v1
      apiKeyEnv: OLLAMA_PLACEHOLDER_KEY   # pi-ai bắt buộc có key kể cả server không cần
      models:
        - id: qwen3:8b
          contextWindow: 32768
```

### 1.2 Việc cần làm

| # | Việc | Chạm vào |
|---|---|---|
| 1.1 | Đổi model mặc định khỏi DeepSeek | row `agent-default-model` trong `packages/bundle/base/cordis.patch.yml` — sửa bằng `cordis.patch.yml` của profile, không cần fork bundle |
| 1.2 | Disable các row gắn DeepSeek | `llm-deepseek`, `deepseek-llm-api-extensions`, `plugin-package-inventory-deepseek`, `web-search-deepseek` |
| 1.3 | Tắt onboarding "nhập key DeepSeek" | `packages/client/ui-settings-models/` — dialog first-run tự bỏ qua nếu đã có provider dùng được, nên seed sẵn provider là đủ |
| 1.4 | Branding | `packages/client/ui-brand-official/` điền slot `sidebar.brand.*`, `conversation.hero.brand.mark` — thay bằng plugin brand riêng, không sửa core |
| 1.5 | *(tuỳ chọn)* thêm protocol Gemini native | bảng `PROTOCOLS` trong `packages/llm/llm-pi-ai/src/provider.ts` — chỉ khi endpoint OpenAI-compat của Google không đủ |

**Giới hạn cần biết trước:**
- Một route = một protocol. Gateway nói 2 protocol → khai 2 route.
- Model khai tay mặc định text-only; muốn nhận ảnh phải thêm `input: [text, image]` trong `settings.yaml`.
- Model catalog không tự refresh; `settings.yaml` là nguồn sự thật.
- Settings layer chỉ **thêm/đè** route, **không xoá** được route do composition cấp.

-----

## 2. Dùng ChatGPT / Gemini làm LLM "free"

### 2.1 Nói thẳng về rủi ro trước

Lái trực tiếp **giao diện web** ChatGPT/Gemini (headless browser, cookie session, extension bơm DOM) vi phạm ToS của cả hai bên và thường dẫn tới khoá tài khoản. Về kỹ thuật nó cũng tệ cho một harness:

- Không có tool-calling gốc → toàn bộ `tool/call` phải mô phỏng bằng prompt-parsing
- Không có `usage` token → `token-meter` và `packages/compaction` chạy mù
- Không có replay state → mất `replayState` mà adapter contract yêu cầu
- Cloudflare/bot-check và DOM đổi liên tục
- Phải giả lập `StreamChunk`, dễ vi phạm ràng buộc "emit `usage` TRƯỚC `finish`, không emit gì SAU `finish`"

Đây là ý kiến kỹ thuật, không phải từ chối. Mục 2.3 có thiết kế nếu anh vẫn muốn.

### 2.2 Đường hợp lệ, gần như cùng chi phí (khuyến nghị)

**(a) Gemini API free tier — 0 dòng code.** Key từ Google AI Studio, endpoint OpenAI-compat `https://generativelanguage.googleapis.com/v1beta/openai/` → khai custom provider như ví dụ mục 1.1. Đây là câu trả lời sát nhất cho "Gemini free".

**(b) OpenRouter model `:free` — 0 dòng code.** `openrouter` đã có trong catalog pi-ai.

**(c) Local (Ollama / LM Studio / vLLM) — 0 dòng code.** Free thật, nhớ đặt `apiKeyEnv` placeholder.

**(d) ChatGPT gói trả phí qua Codex OAuth — hợp lệ, và repo đã có sẵn nửa dưới.**

- `packages/credentials/authorization/` — seam `ctx.authorization`, flow đăng nhập, ghi credential record
- `packages/llm/llm-pi-ai/src/login.ts` — đã dịch `AuthInteraction` của pi-ai sang vocabulary của seam, đã có ví dụ `'Sign in with ChatGPT'`
- Credential lưu tại `llm-pi-ai/<provider id>`, tự refresh dưới cross-process lock

Nhưng **chưa nối lên sản phẩm**:

- `dsh-authorization` **không được mount ở bất kỳ bundle nào** (grep `packages/bundle` + `apps`: 0 kết quả)
- Không có `@Remote` nào cho authorization
- `docs/user/guide/providers.md:19` ghi thẳng: *"Providers that sign in with OAuth, such as Codex, are not supported here yet."*
- `packages/llm/llm-pi-ai/src/provider.ts:121` — `openai-codex` là OAuth-only nên bị loại khỏi bảng protocol khai tay; route catalog vẫn tới được nó

→ Việc phải làm: **(i)** thêm row `authorization` vào `dsh-base`, **(ii)** Remote `authorization/list|start|answer|cancel`, **(iii)** nút Sign in vào slot có sẵn `settings.models.provider-card` (làm được thành plugin riêng, không sửa file gốc). **3–5 ngày.**
Giới hạn đã ghi sẵn: flow **không resumable** — reload trang giữa lúc login là mất.

**(e) Gemini free qua OAuth tài khoản Google (Code Assist API).** Không có trong pi-ai, protocol riêng, phải viết adapter mới. **1–2 tuần.** Chỉ làm nếu (a) không đủ hạn mức.

### 2.3 Nếu vẫn muốn browser-driven provider

Đặt ở `packages/experimental/llm-browser-bridge/` — group này **được loại khỏi official release**, đúng chỗ cho thứ không bảo đảm ổn định. Cấu trúc: extension trình duyệt (hoặc CDP qua `packages/experimental/inspector`) ↔ WebSocket local ↔ adapter đăng ký `ctx.llm`. Bắt buộc tuân thủ contract adapter (`usage` trước `finish`, `arguments` là raw JSON string, tôn trọng `options.signal`, field không hỗ trợ → `LlmError('UNSUPPORTED_OPTION')`). **2–3 tuần + bảo trì liên tục.**

-----

## 3. Plugins: gói rules + skills + hooks, gắn theo dự án

### 3.1 Đối chiếu từng thành phần với Claude Code

| Claude Code | Harness có gì | Trạng thái |
|---|---|---|
| `CLAUDE.md` / rules | `packages/context/agent-instructions/` đọc `AGENTS.md`/`CLAUDE.md` theo workspace; `ctx.systemPrompt.section()`; `packages/preset/persona/` | ✅ đủ |
| `skills/<name>/SKILL.md` + scripts | `packages/skill/` — registry `ctx.skills`, provider filesystem quét `<projectRoot>/.dsh/skills`, `.agents/skills`, `<dshHome>/skills`; `SkillResourceBase` cho scripts/assets; watcher chokidar; `/name` invocation | ✅ đủ |
| `hooks/hooks.json` | `packages/hooks/hooks-claude-code/` — **đúng dialect Claude Code**, map sang `agent/session-start`, `agent/pre-step`, `tools/pre-execute`, `tools/post-execute`, `agent/turn-stopping`, `subagent/start\|end` | ✅ **XONG** (3d). Pack mount bridge trong scope của session → hook chỉ chạy cho thư mục được bind. Còn lại: 7/30 hook event được hỗ trợ |
| `commands/*.md` | Skill có `user-invocable` → gõ `/name` là host inject `<skill_content>`; `ctx.commands` dành cho lệnh viết bằng code | ⚠️ ~80%. Thiếu `$ARGUMENTS`, frontmatter `allowed-tools`, `model` |
| `agents/*.md` (subagent) | `packages/subagent/tool-subagent/` nhận `persona`, `toolFilter`, `agentOptions`, `maxDepth` — nhưng khai bằng cordis config | ⚠️ đủ khả năng, thiếu loader `.md` |
| `.mcp.json` | `packages/mcp/mcp-client/` — 1 row cordis mỗi server, `serverName` unique **trong một registration scope** | ⚠️ thiếu loader từ `.mcp.json` |
| `plugin.json` manifest | — | ❌ |
| Marketplace / install | `dsh plugin --profile <name> add <package>` (`apps/cli/src/plugin.ts`) — nhưng cài ở **tầng profile, cho cả máy** | ⚠️ sai tầng |
| Bật plugin cho từng project | — | ❌ |

### 3.2 Vì sao "gắn theo dự án" hiện chưa làm được

- `packages/workspace/` chỉ lưu `id`, `path`, `title`, `createdAt`, `updatedAt`, `sessionIds`. **Không có chỗ gắn cấu hình.** Nó cố tình host-side only: không tool, không prompt, không session event.
- `packages/preset/agent-presets/` cho phép mỗi session một composition riêng, nhưng preset chọn theo **session**, không theo workspace, và roots quét ở `<dshHome>/.agent-presets` chứ không theo project.
- `packages/settings/settings-file/` là **một document duy nhất cho cả harness home**, không per-workspace.
- Chỉ đúng **2 package** trong toàn repo biết đến project root: `agent-instructions` và `skill-filesystem` (grep `projectRoot|gitRoot` trên `packages/*/*/src`). Mọi thứ còn lại — hooks, MCP, commands, subagent — là process-wide.

### 3.3 Nền tảng: cơ chế scoping đã có sẵn — **đã kiểm chứng bằng test**

> **Trạng thái: Phase 3a xong.** Bằng chứng: `packages/preset/agent-presets/tests/listener-scope.spec.ts` (4/4 pass; cả suite `agent-presets` 190/190 pass). Không phải suy luận từ đọc code.

Đây là lý do việc này khả thi mà không phải sửa lõi:

1. **Mọi `agent/*` event đều scope-dispatched.** `packages/core/agent/src/runtime-types.ts` khai mỗi event với `this: Scoped<Agent>`, dispatch qua `agentCarrier(agent) = scopeTarget(agent, agent)` (`dispatch.ts:94`).
2. **Mọi `tools/*` event cũng vậy.** `packages/core/tools/src/index.ts:144-167` dùng `this: Scoped<ToolRuntime>`, và `tools/post-execute` dispatch bằng `scopeTarget(this, exec.agent)` (dòng 1735).
3. **Registry phân tầng host + per-scope.** `ctx.skills` và `ctx.tools` đọc theo "global layer + chuỗi scope của người xem"; *"a plugin mounted by an agent preset's standing composition lands in that preset's layer"*.
4. **`agent-presets` đã có standing mount:** mount composition một lần cho mỗi preset, agent join bằng scope parentage, có single-flight, có generation theo mtime file, có báo `broken` kèm lý do.

Luật lọc nằm ở `scopeTarget` (`packages/core/scope/src/index.ts:170-183`), ngắn và dứt khoát:

```js
const tag = scopeOf(ctx)
if (tag === undefined) return true              // listener không tag → toàn cục
for (let cursor = key; cursor; cursor = scopeParents.get(cursor)) {
  if (cursor === tag) return true               // listener trên chuỗi scope của agent → nhận
}
return false                                    // ngoài chuỗi → bị loại
```

Sự kiện chảy **lên** chuỗi scope, không bao giờ chảy xuống: composition bao ngoài quan sát được mọi agent bên trong nó, còn một tag nằm dưới điểm dispatch thì bị loại.

**Kết quả kiểm chứng** (`listener-scope.spec.ts`) — một preset row chỉ đăng ký listener, không đăng ký gì khác:

| Điều đã chứng minh | Ý nghĩa cho pack |
|---|---|
| `agent/pre-step` chỉ chạy cho agent composed từ preset đó; agent ở preset khác không chạm tới | Hook `UserPromptSubmit` / `SessionStart` của pack không rò sang dự án khác |
| Nhiều agent cùng preset đều nhận, không rò chéo | Nhiều session trong cùng dự án dùng chung một pack |
| `tools/pre-execute` bị lọc y hệt | Hook `PreToolUse` — cổng chặn tool quan trọng nhất — cũng an toàn |
| Một agent dispose không ảnh hưởng agent anh em cùng preset | Đóng session không phá pack của session khác |

**Hệ quả:** giới hạn *"one config applies to the whole process"* của `dsh-hooks-claude-code` **không phải giới hạn kiến trúc** — nó chỉ là hệ quả của việc hiện nay bridge được mount ở tầng host. Mount nó bên trong composition có scope là đủ. Điều đó áp dụng y hệt cho `mcp-client` (`serverName` đã unique theo registration scope), `tool-subagent`, và mọi tool row khác.

Tóm lại: **"add plugin X cho dự án A" = mount composition của X vào scope của session thuộc dự án A.** Máy móc đã đủ và đã chứng minh; thiếu là (i) định dạng gói, (ii) chỗ lưu ràng buộc workspace↔plugin, (iii) UI.

~~**Một điều spike CHƯA chứng minh:**~~ → **ĐÃ CHỨNG MINH.** `packages/pack/pack-mount/tests/hooks-composition.spec.ts` mount chính `dsh-hooks-claude-code` (không phải fixture) qua provider thật, chạy hook shell thật: hai thư mục bind hai pack khác nhau, mỗi session chỉ thấy hook của pack mình; chỉ session được bind mới ghi cặp `hook/invoked`/`hook/result`.

### 3.4 Kiến trúc đề xuất

**Về tên gọi:** từ "plugin" trong repo này đã bị chiếm — plugin Cordis là đơn vị row trong `cordis.yml`, `dsh plugin add` cài bundle vào profile, và đã có section Settings tên "Plugins" (`packages/client/ui-settings-plugins/`) lẫn `packages/host/plugin-inventory/`. Dùng lại "plugin" sẽ gây nhầm nghiêm trọng trong code và doc. Em đề xuất tên nội bộ **Pack** (`ctx.packs`) và giữ chữ "Plugin" cho **UI hiển thị với người dùng cuối** — người dùng thấy "Plugins", code gọi là Pack.

**Định dạng gói (đặt cạnh Claude Code cho dễ chuyển đổi):**

```
viet-truyen/
  pack.yml              # manifest: id, name, description, icon, category, version, requires
  rules/*.md            # → prompt section / injected context
  skills/<name>/SKILL.md + scripts/
  hooks/hooks.json      # dialect Claude Code — bridge đã có sẵn
  commands/*.md         # prompt template (map sang skill user-invocable)
  agents/*.md           # subagent: persona + toolFilter + model
  mcp.json              # MCP servers
  pack.cordis.yml       # (nâng cao, tuỳ chọn) row cordis thuần
```

`pack.yml` là chỗ chứa "trường thêm vào để hiển thị lên UI" mà anh muốn: `icon`, `category`, `tagline`, `order`, `requires`.

**Các package cần thêm:**

```
packages/pack/
  pack/                 # Service Definition — ctx.packs (registry + vocabulary)
  pack-loader/          # đọc thư mục pack.yml → composition rows (rules/skills/hooks/commands/agents/mcp)
  pack-packaged/        # Provider: pack do MÌNH đóng gói trong npm package (kiểu skill-badge)
  pack-local/           # Provider: pack trong <dshHome>/.packs — dev/nội bộ
  pack-remote/          # Provider: pack tải từ server, kèm entitlement token       [Phase sau]
  pack-binding/         # workspaceId → packIds[], lưu qua ctx.storageDomain

packages/api/pack-controller/     # @Remote packs/list, packs/bind, packs/unbind
packages/client/ui-packs/         # màn hình "Plugins" + bật/tắt theo dự án
```

Theo đúng luật repo: một seam gồm đủ 3 vai **Service Definition / Service Provider / Consumer**, không làm lẻ một vai.

**Luồng chạy** (binding theo workspace, đã chốt):

```
Người dùng thêm thư mục dự án A  → packages/workspace tạo Workspace record
Bật plugin X cho dự án A         → pack-binding ghi { workspaceId: A, packs: [X] } qua ctx.storageDomain
Tạo session mới trong dự án A
  → resolve: preset của session + composition của mọi pack đang bind
  → mount vào standing scope (dùng lại máy móc của agent-presets)
  → từ đó: skills của X vào layer của scope, hooks của X chỉ nghe agent trong scope,
     MCP server của X chỉ đăng ký tool trong scope, rules của X vào prompt section
```

**Hai lựa chọn triển khai:**

- **Phương án A (khuyến nghị):** mở rộng `agent-presets` để composition của session = `rows(preset)` + `rows(pack₁..packₙ)`, cache theo cặp `(presetId, tập packId)`. Dùng lại nguyên standing mount, scope layering, single-flight, generation theo mtime, báo `broken` kèm lý do. Rủi ro chính: bùng nổ tổ hợp nếu nhiều pack — giới hạn bằng cache LRU và số pack tối đa mỗi workspace (là `Config` field, không hardcode).
- **Phương án B (MVP nhanh hơn):** không dựng composition, chỉ đăng ký trực tiếp qua scoped `ctx` lúc session start: rules → `systemPrompt.section()`, skills → `ctx.skills.register()`. Làm nhanh, nhưng **không** chạy được hooks/MCP/subagent vì những thứ đó cần row cordis thật.

→ Đề xuất: bắt đầu bằng B cho rules+skills để có sản phẩm chạy sớm, rồi chuyển sang A khi thêm hooks/MCP. Ghi rõ trong Agent Note rằng B là bước trung gian, tránh biến nó thành nợ vĩnh viễn.

**Việc bổ sung cho các thành phần chưa đủ:**

| Việc | Chi tiết |
|---|---|
| ~~Hook per-scope~~ ✅ **XONG** | Không sửa `hooks-claude-code`; `pack-local` sinh row trỏ `configPath` vào `hooks/hooks.json` của pack và `pluginRoot` vào thư mục pack. `projectDir` để trống nên `CLAUDE_PROJECT_DIR` mặc định là thư mục dự án được bind, không phải thư mục pack |
| `commands/*.md` | Loader biến mỗi file thành skill `user-invocable: true`, `disable-model-invocation: true`. Cần thêm khai triển `$ARGUMENTS` — hiện `/name` chỉ inject nguyên văn body |
| `agents/*.md` | Loader sinh row `tool-subagent` với `persona` + `toolFilter` + `agentOptions` từ frontmatter |
| `.mcp.json` | Loader sinh mỗi server một row `mcp-client` |
| Hook event còn thiếu | Bridge mới hỗ trợ 7/30 event Claude Code. Nếu pack cần `PreCompact`, `SessionEnd`, `PermissionRequest`… thì phải mở rộng bridge — việc riêng, ước tính theo từng event |

### 3.5 Phân quyền theo tài khoản

Phần này chưa có gì cả: `packages/identity/anonymous-user-id` chỉ là id ẩn danh, `packages/host/webserver` không có auth, settings là một file chung cho cả máy.

```
packages/entitlement/
  entitlement/            # Service Definition — ctx.entitlements.has(key) / list()
  entitlement-license/    # license file ký Ed25519, verify offline bằng public key nhúng
  entitlement-remote/     # gọi server của anh, cache + TTL + fail-closed
```

**Gating 3 tầng:**
1. **Provider chỉ list pack mà tài khoản có quyền** — tầng thật. Nội dung pack "Kế toán" không rời server nếu không có quyền.
2. **Remote `packs/*` kiểm tra lại** — không tin client.
3. **UI** chỉ hiển thị; card khoá (nếu có) chỉ chứa metadata quảng cáo.

**Sự thật phải chấp nhận:** app chạy **local trên máy user** thì mọi file trên máy đó đều đọc được — kể cả `--dump-config`. Muốn khoá thật, nội dung pack **phải** ở server và trả theo token (`pack-remote`). Bản `pack-packaged` chỉ chống được người dùng thường.

**Chặn user tự tạo pack:** registry pack **không** đọc từ `skill-filesystem`. Chỉ các provider được đăng ký mới vào được; chặt hơn nữa thì mỗi pack kèm chữ ký `pack.sig` verify bằng public key nhúng trong plugin — pack không có chữ ký hợp lệ bị bỏ. Skill người dùng tự viết vẫn chạy bình thường qua `/name`, chỉ là không thành pack.

**Tài khoản:** nếu deploy nhiều người dùng thì đây là hạng mục riêng và không nhỏ — auth ở `packages/host/webserver`, identity request-scoped, và `packages/settings` phải per-account thay vì một file. **Cần anh quyết deploy local hay server trước.**

-----

## 3.6 Chi phí đồng bộ với upstream — đo từ lịch sử repo

Repo này là bản sao của DeepSeek Harness (`origin = long-hp/x-harness`, không có remote `upstream`). Câu hỏi "có nên kéo update từ repo gốc không" trả lời được bằng số:

```
15.210 commit trong ~3 tháng (2026-06-10 → 2026-09-04)
6.021 commit chỉ trong 30 ngày cuối        ≈ 200 commit/ngày
```

| File mình sẽ SỬA | Tổng commit | 30 ngày cuối |
|---|---|---|
| `bundle/web-app/cordis.patch.yml` | 122 | **122** |
| `bundle/base/cordis.patch.yml` | 59 | **59** |
| `api/session-controller/src/agent.ts` | 5 | 5 |

| API mình PHỤ THUỘC | Tổng | 30 ngày cuối |
|---|---|---|
| `core/tools/src/index.ts` | 176 | **51** |
| `preset/agent-presets/src/index.ts` | 50 | **50** |
| `skill/skill/src/index.ts` | 31 | 9 |
| `workspace/workspace/src/index.ts` | 19 | 8 |
| `core/scope/src/index.ts` | 19 | 4 |
| `storage/storage-domain/src/index.ts` | 4 | 2 |

Cột "tổng = 30 ngày cuối" ở `agent-presets`, hai file bundle và `storage-domain` nghĩa là những package đó **mới được tạo trong vòng một tháng**: toàn bộ nền mà kế hoạch này dựa lên là phần mới nhất và động nhất của repo. `SESSION_FORMAT_VERSION` đã bị đụng trong 97 commit.

**Rủi ro thật không phải xung đột văn bản mà là vỡ ngầm.** `AGENTS.md` ghi *"Public APIs are pre-stable; update every consumer"* — upstream đổi interface không deprecation. Xung đột thì thấy ngay; API đổi chỉ typecheck/test mới bắt được.

### Quyết định

- **Giữ `.git`.** Blame đáng giá đúng ở đây vì các subsystem mình dựa vào mới một tháng tuổi; blame → PR → Agent Note là đường tra nhanh nhất. Giữ `.git` cũng giữ khả năng cherry-pick một bản vá cụ thể khi cần.
- **Không lên lịch merge upstream.** Ở nhịp 200 commit/ngày, merge định kỳ là công việc thường trực. Xử lý theo sự cố: gặp bug, biết upstream đã sửa, cherry-pick đúng commit đó.
- **Không sửa hai file bundle nóng.** Phase 1 (đổi default model, gỡ DeepSeek, đổi brand) và việc mount package mới đều làm ở **profile patch layer** trong Harness home — đúng cơ chế repo thiết kế cho việc này, zero sửa file gốc.

### Đường "zero-edit" đã đánh giá — không dùng

Ý tưởng: sinh preset tự động cho mỗi workspace (preset gốc + rows của pack) để `composeAgent` không phải đổi dòng nào.

**Kết luận: không dùng, vì rò.** Preset mặc định resolve từ `this.settings?.get().default ?? this.config.default` (`agent-presets/src/index.ts:241`) — giá trị **toàn cục, không biết workspace**. Muốn workspace A dùng preset sinh ra cho A thì *người gọi* phải truyền `presetId`, tức chỉ những surface mình kiểm soát (Web client) mới có pack; webhook (`webhook/src/session.ts:142`), SDK, ACP, headless sẽ im lặng không có pack.

**Thay bằng một sửa đổi nhỏ, có chủ đích:** `composeAgent()` (`api/session-controller/src/agent.ts:374`) — file chỉ 5 commit, tương đối nguội. Cần thêm tham số `cwd` (hiện chữ ký chỉ nhận `presetId`; `AgentSetup` chỉ nhận `agentCtx` nên không tự lấy được cwd) và một dòng gọi service tuỳ chọn:

```ts
setup: async (agentCtx) => {
  this.installSelection(agentCtx)
  await presets.mount(agentCtx, resolvedId)
  await this.ctx.get('packs')?.mountForCwd(agentCtx, cwd)   // vắng service thì không làm gì
},
```

**Đã làm, và rộng hơn dự tính.** `composeAgent()` chỉ phục vụ `session-controller`, mà package đó **chỉ có trong bundle `web-app`**. Nên sửa mình `agent.ts` thì headless / ACP / SDK / webhook vẫn im lặng không có pack — đúng cái lỗ rò mà đường "zero-edit" bị loại vì nó. Kết quả: gọi `ctx.get('packMount')?.mount(agentCtx, cwd)` ở **cả 5 entry point**:

| Entry point | Thư mục nó mount cho |
|---|---|
| `ApiSessionAgentController.composeAgent()` | `cwd` của session (web app + Remote API) |
| `dsh-headless` | thư mục lúc khởi chạy |
| `dsh-acp` | `cwd` trong request `newSession` |
| `dsh-sdk-server` | thư mục khai lúc `initialize` |
| `dsh-webhook` | đường dẫn workspace đã resolve |

Không gom về một chỗ được vì `setup` là callback do **bên tạo agent** cung cấp, và giữa chúng không có điểm chung nào còn chạy trước lúc publish. Lặp lại lời gọi chính là thứ làm cho khoá-theo-đường-dẫn đúng như tên gọi. Dùng `ctx.get('packMount')?` để composition không mount pack vẫn chạy nguyên vẹn — đúng luật "misconfiguration fails loud, absence is explicit".

-----

## 4. Lộ trình

| Phase | Nội dung | Kết quả | Ước tính |
|---|---|---|---|
| **0** | Cấu hình `settings.yaml`: OpenRouter + Gemini AI Studio + Ollama | Nhiều model, có đường free | 0.5 ngày, không code |
| **1** | Đổi default model, disable row DeepSeek, thay brand plugin | Không còn mặc định DeepSeek | 1–2 ngày |
| **2** | Mount `dsh-authorization` + Remote + nút Sign in vào `settings.models.provider-card` | Đăng nhập ChatGPT (Codex) từ UI | 3–5 ngày |
| **3a** | ✅ **XONG** — `packages/preset/agent-presets/tests/listener-scope.spec.ts`: chứng minh listener của một preset row chỉ nhận agent trong scope, cho cả `agent/pre-step` lẫn `tools/pre-execute` | Nền tảng đã xác nhận | đã xong |
| **3b** | ✅ **XONG** — `ctx.packs`, `pack-local`, `pack-rules`, `pack-binding` (khoá theo đường dẫn chuẩn hoá, không theo `WorkspaceId`), `pack-mount` + nối vào cả 5 entry point (web/Remote, headless, ACP, SDK, webhook). 5 package, coverage 100% | Bật pack cho thư mục → phiên mới trong đó có rules/skills/hooks của pack, ở mọi profile | đã xong |
| **3c** | `ui-packs`: màn hình Plugins, bật/tắt theo dự án | Thao tác được trên app | 1 tuần |
| **3d** | ✅ **hooks XONG** — `hooks/hooks.json` thành row `dsh-hooks-claude-code`, chứng minh bằng test composition thật. Còn `commands/*.md`, `agents/*.md`, `mcp.json` | Pack đầy đủ như Claude Code | còn 1 tuần |
| **4** | `ctx.entitlements` + `entitlement-license` + ký pack | Khoá/mở theo license | 1–2 tuần |
| **5** | `pack-remote` + auth tài khoản ở webserver + settings per-account | Bán theo gói thật | 2–4 tuần, phụ thuộc quyết định deploy |
| **6** | *(tuỳ chọn, rủi ro cao)* `llm-browser-bridge` trong `packages/experimental/` | ChatGPT/Gemini web làm LLM | 2–3 tuần + bảo trì |

Phase 0–2 độc lập với 3–5, chạy song song được. **Phase 3a không được bỏ qua** — toàn bộ thiết kế đứng trên giả định scoping ở mục 3.3.

-----

## 5. Ràng buộc của repo phải tuân khi làm

Trích từ `AGENTS.md` / `packages/AGENTS.md` / `docs/testing.md`, những điều dễ vướng nhất:

- **Seam đủ 3 vai.** Thêm capability = Service Definition + Provider + Consumer, không làm lẻ.
- **Registration là effect.** Mọi đăng ký qua `ctx.effect()` / `ctx.on()`; `register()` trả về disposer.
- **Model-visible ⟺ logged.** Bất cứ thứ gì tới request của model phải dựng lại được từ session log. Rules của pack là model-visible → phải là session event (mở rộng `SessionEventMap`, ví dụ `pack/applied`), giống cách `agent-preset/selected` đang làm.
- **Không hardcode tunable trong plugin.** Số pack tối đa, kích thước cache, timeout đều phải là field `Config` có validate.
- **Id qua ranh giới phải branded** (`Branded<B>` từ `dsh-brand`) → `PackId`, `EntitlementKey`.
- **Sai cấu hình fail loud** ngay lúc load; pack hỏng phải hiện lý do như `agent-presets` làm với `broken`, không im lặng bỏ qua.
- **UI copy qua locale dictionary.** `verify-client-ui-i18n` từ chối text cứng.
- **Không thêm bin mới.** `verify-application-entrypoints` chặn mọi app Node không đi qua `dsh --profile`.
- **Test:** `pnpm run test:coverage` là gate CI (100% per-file trên `packages/*/*/src`), không phải `test`. Thay đổi model- hoặc user-visible → cập nhật snapshot (`pnpm run test:snapshot`) và cả **TypeScript + Python SDK expected output** nếu chạm agent-loop / `SessionEventMap`.
- **Doc đi kèm code:** README package theo template kind + JSDoc; `pnpm run doc-sync`.
- **Agent Note bắt buộc** cho mọi thay đổi không tầm thường, trong cùng PR.
- **Đặt tên package:** hiện là `@deepseek-ai/dsh-<name>`, `@deepseek-ai/cordis` là peerDependency. Fork thành sản phẩm riêng thì cân nhắc rescope (`docs/rescope.md`).

-----

## 6. Cần anh quyết trước khi code

1. **Deploy ở đâu?** Local từng máy (như hiện tại) hay server nhiều người dùng? → quyết định toàn bộ Phase 5 và quyết định entitlement có ý nghĩa thật hay chỉ là rào mềm.
2. ~~Fork riêng hay giữ upstream?~~ → **ĐÃ CHỐT** (xem [3.6](#36-chi-phí-đồng-bộ-với-upstream--đo-từ-lịch-sử-repo)): giữ `.git`, không lên lịch merge, né hai file bundle nóng bằng profile patch layer, và **không rescope tên package** lúc này — đổi `@deepseek-ai/dsh-*` sang scope riêng sẽ chạm mọi file và xoá sạch khả năng cherry-pick.
3. ~~Pack gắn theo workspace hay theo session?~~ → **ĐÃ CHỐT: theo workspace.** `pack-binding` lưu `<đường dẫn chuẩn hoá> → packId[]` (không phải `WorkspaceId`: `dsh-workspace` chỉ có ở profile web, còn phiên trong thư mục đó mở được từ mọi profile), không có tầng override ở session. Session đọc binding của workspace nó thuộc về, tại thời điểm tạo session, và giữ nguyên suốt đời session (giống hệt luật preset hiện có: đổi composition giữa chừng sẽ để lại tool call đã log mà composition mới không gọi được).
4. **Pack có được ghi đè lẫn nhau không?** Hai pack cùng khai một skill tên `viet-truyen` thì ai thắng? Registry hiện resolve theo rank + thứ tự provider trong một layer; cần chốt luật cho pack (thứ tự bind, hay cấm trùng và fail loud — em nghiêng về fail loud).
5. **Đường ChatGPT/Gemini free:** chốt (a)+(b)+(d) hợp lệ, hay vẫn muốn (2.3) browser bridge?
6. **Mức chống sao chép:** chấp nhận "chống người dùng thường" (packaged + ký), hay bắt buộc "nội dung không bao giờ nằm trên máy user" (remote provider, cần server)?
