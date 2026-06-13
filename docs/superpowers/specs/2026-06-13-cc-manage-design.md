# cc-manage 设计文档

## 概述

cc-manage 是一个本地 Web 工具，用于统一管理 Claude Code 和 Codex CLI 的对话历史、记忆文件和用量监控。通过 npm 全局安装，启动后提供 Web UI，可通过 VSCode 端口转发在浏览器中访问。

## 功能模块

### 1. 对话管理（Sessions）

**数据源：**
- Claude Code：`~/.claude/projects/` 下的 `*.jsonl` 文件，跳过 `agent-` 前缀
- Codex：`~/.codex/sessions/` 和 `~/.codex/archived_sessions/` 下的 `*.jsonl`，跳过含 `source.subagent` 的子代理会话

**解析策略：**
- 采用 head+tail 策略：读取前 10 行 + 尾部 30 行提取元数据
- 文件小于 16KB 时全量读取
- 大文件通过 seek 到末尾 16KB 读取尾部

**标题解析优先级：**
- Claude：`type: "custom-title"` 条目 → 第一条用户消息 → 项目目录名
- Codex：第一条用户消息（过滤 AGENTS.md 注入、`<environment_context>` 块、VS Code IDE 上下文前缀）→ 项目目录名
- 标题截断到 80 字符

**分组与排序：**
- 一级分组：工具类型（Claude Code / Codex）
- 二级分组：项目工作区（从 JSONL 中 `cwd` 字段提取）
- 组内按最后活动时间降序排列

**操作：**

| 操作 | 实现方式 |
|------|----------|
| 列表 | 扫描 + head+tail 解析，返回元数据列表 |
| 查看 | 全量解析 JSONL，返回结构化消息数组 |
| 删除 | Claude：删除 JSONL + 同 UUID 的 sidecar 目录；Codex：删除 JSONL |
| 改标题 | 追加 `{"type":"custom-title","title":"...","timestamp":...}` 到 JSONL 末尾 |
| 批量删除 | 接收 ID 数组，逐个执行删除 |

**安全：** 所有文件操作前对路径做规范化（`path.resolve` + `realpath`），验证在允许的根目录下，防止路径遍历攻击。

### 2. 记忆管理（Memory）

**Claude Code（完整 CRUD）：**
- 数据位置：`~/.claude/projects/<project>/memory/` 目录
- 文件格式：`.md` 文件，YAML frontmatter 包含 name、description、metadata.type
- 索引文件：`MEMORY.md`，每条记忆一行指针
- 支持操作：
  - 列出所有项目及其记忆文件
  - 读取记忆文件内容（frontmatter + body）
  - 创建新记忆文件（自动更新 MEMORY.md）
  - 编辑记忆文件内容
  - 删除记忆文件（自动从 MEMORY.md 移除对应条目）

**Codex（只读浏览）：**
- 数据位置：`~/.codex/memories_1.sqlite`
- 使用 better-sqlite3 读取
- 展示记忆条目列表和内容，不支持编辑

### 3. 用量监控（Usage）

**凭据读取：**
- Claude：`~/.claude/.credentials.json` → `claudeAiOauth` 或 `claude.ai_oauth` 字段，验证 token 是否过期
- Codex：`~/.codex/auth.json` → 需 `auth_mode: "chatgpt"`，token 超过 8 天视为过期

**API 端点：**
- Claude：`GET https://api.anthropic.com/api/oauth/usage`，Bearer token
- Codex：`GET https://chatgpt.com/backend-api/wham/usage`，Bearer token

**档位映射：**
- Claude：API 返回命名档位（`five_hour`、`seven_day`、`seven_day_opus`、`seven_day_sonnet`）
- Codex：根据窗口秒数映射（18000s → five_hour，604800s → seven_day）

**展示：**
- 各档位以进度条展示使用百分比
- 颜色阈值：<70% 绿色、70-90% 橙色、>90% 红色
- 显示重置时间倒计时

**刷新策略（可见性驱动）：**
- 前端使用 Page Visibility API（`document.visibilityState`）+ 路由感知
- 用户进入 Usage 页面 或 页面从后台切回前台时：立即发起一次请求
- 页面可见且处于 Usage 页面时：每 60 秒轮询一次
- 页面切到后台 或 离开 Usage 页面时：停止轮询，不发送任何请求
- 后端不做主动轮询，仅响应前端的 GET 请求并实时调用上游 API（可加短时内存缓存避免并发重复请求，TTL 10 秒）

## 技术架构

### 技术栈

| 层 | 选择 |
|----|------|
| 运行时 | Node.js 20 |
| 语言 | TypeScript（前后端共用） |
| 后端框架 | Fastify |
| 前端框架 | React 18 + TailwindCSS + shadcn/ui |
| 前端构建 | Vite |
| 后端构建 | tsup |
| JSONL 解析 | 自实现（参考 cc-switch 的 head+tail 策略） |
| SQLite 读取 | better-sqlite3 |
| 进程管理 | PID 文件 + 后台守护 |

### 项目结构

```
cc-manage/
├── package.json
├── tsconfig.json                  # 前端 TS 配置
├── tsconfig.server.json           # 后端 TS 配置
├── vite.config.ts
├── bin/
│   └── cc-manage.ts               # CLI 入口
├── src/
│   ├── server/
│   │   ├── index.ts               # Fastify 服务器启动、静态文件托管
│   │   ├── routes/
│   │   │   ├── sessions.ts        # 对话相关 API
│   │   │   ├── memory.ts          # 记忆相关 API
│   │   │   └── usage.ts           # 用量相关 API
│   │   ├── providers/
│   │   │   ├── claude.ts          # Claude Code 数据发现与解析
│   │   │   └── codex.ts           # Codex 数据发现与解析
│   │   └── services/
│   │       ├── session-parser.ts  # JSONL 解析器（head+tail）
│   │       ├── memory-manager.ts  # Claude 记忆文件 CRUD
│   │       ├── codex-memory.ts    # Codex SQLite 只读访问
│   │       └── usage-fetcher.ts   # OAuth token 读取 + 上游 API 调用
│   └── client/
│       ├── index.html
│       ├── main.tsx               # React 入口
│       ├── App.tsx                # 路由 + 布局
│       ├── pages/
│       │   ├── Sessions.tsx       # 对话管理页
│       │   ├── Memory.tsx         # 记忆管理页
│       │   └── Usage.tsx          # 用量监控页
│       ├── components/
│       │   ├── SessionList.tsx    # 左侧树形对话列表
│       │   ├── SessionViewer.tsx  # 右侧对话内容查看器
│       │   ├── MemoryTree.tsx     # 左侧记忆文件树
│       │   ├── MemoryEditor.tsx   # 右侧 Markdown 编辑器
│       │   ├── UsageGauge.tsx     # 用量进度条组件
│       │   └── Layout.tsx         # 顶部标签栏 + 整体布局
│       ├── hooks/
│       │   ├── useVisibilityPolling.ts  # 可见性驱动轮询 hook
│       │   └── useSessions.ts     # 对话数据 hook
│       └── lib/
│           └── api.ts             # 后端 API 调用封装
└── dist/
    ├── server/                    # tsup 编译后的后端代码
    └── client/                    # Vite 构建后的前端静态文件
```

### API 设计

```
# 对话管理
GET    /api/sessions                         # 获取所有对话（按工具+项目分组）
GET    /api/sessions/:provider/:id/messages  # 获取某个对话的完整消息
DELETE /api/sessions/:provider/:id           # 删除单个对话
PATCH  /api/sessions/:provider/:id           # 修改对话标题 { title: string }
POST   /api/sessions/batch-delete            # 批量删除 { ids: [{provider, id}] }

# 记忆管理
GET    /api/memory/claude                    # 列出所有项目及其记忆概览
GET    /api/memory/claude/:project           # 某项目的记忆文件列表
GET    /api/memory/claude/:project/:file     # 读取记忆文件内容
PUT    /api/memory/claude/:project/:file     # 更新记忆文件 { content: string }
POST   /api/memory/claude/:project           # 创建记忆 { filename, content }
DELETE /api/memory/claude/:project/:file     # 删除记忆文件
GET    /api/memory/codex                     # Codex 记忆列表（只读）

# 用量监控
GET    /api/usage                            # 获取当前用量快照（实时调用上游）
GET    /api/usage/:provider                  # 获取某个工具的用量
```

### CLI 设计

```bash
cc-manage start [--port 3456]    # 启动 Web 服务（默认端口 3456），后台守护运行
cc-manage stop                    # 停止服务（通过 PID 文件定位进程）
cc-manage status                  # 查看服务状态（是否运行、端口、PID）
```

进程管理：
- 启动时将 PID 写入 `~/.cc-manage/cc-manage.pid`
- stop 命令读取 PID 文件发送 SIGTERM
- status 命令检查 PID 文件 + 进程是否存活

### npm 分发

```json
{
  "name": "cc-manage",
  "version": "0.1.0",
  "bin": {
    "cc-manage": "./dist/bin/cc-manage.js"
  },
  "files": ["dist/"],
  "scripts": {
    "build": "npm run build:client && npm run build:server",
    "build:client": "vite build",
    "build:server": "tsup src/server/index.ts src/bin/cc-manage.ts --format esm --dts",
    "dev": "concurrently \"vite\" \"tsx watch src/server/index.ts\""
  }
}
```

发布时 `dist/` 包含预构建的前端静态文件和编译后的后端代码，用户安装后无需本地构建。

### 安全考虑

- **网络隔离：** 仅监听 `127.0.0.1`，不暴露到公网
- **路径遍历防护：** 所有文件操作前做 `path.resolve` + `fs.realpath` 规范化，校验结果在允许的根目录（`~/.claude/`、`~/.codex/`）下
- **OAuth token 安全：** token 仅在服务端内存中使用，不通过任何 API 端点暴露给前端
- **输入校验：** 所有 API 参数做类型和边界校验

### 前端页面设计

**整体布局：** 顶部标签栏（Sessions / Memory / Usage），下方为各页面内容。风格对标 cc-switch 深色主题。

**Sessions 页：**
- 左侧：树形列表，一级节点为工具类型（Claude Code / Codex），二级为项目工作区，三级为对话条目（标题 + 时间）
- 右侧：选中对话的消息内容，按角色（user/assistant）分块展示
- 操作栏：搜索框、多选模式、批量删除按钮
- 对话标题可双击编辑

**Memory 页：**
- 左侧：按工具和项目分组的文件树
- 右侧（Claude）：Markdown 编辑器，显示 frontmatter 元数据 + body 内容，可编辑保存
- 右侧（Codex）：只读内容查看器
- 操作：新建记忆、删除记忆

**Usage 页：**
- Claude Code 和 Codex 各自独立卡片
- 每张卡片内按档位（five_hour、seven_day 等）显示进度条
- 进度条颜色：<70% 绿色、70-90% 橙色、>90% 红色
- 每个档位下方显示重置倒计时
- 进入页面时立即刷新，可见时每 60 秒自动刷新，离开或切后台时停止
