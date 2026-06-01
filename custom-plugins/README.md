# 自定义插件开发指南

本指南说明如何在 ClawWin2.0 中开发、管理和加载自定义 OpenClaw 插件与 Skills。

## 目录结构

```
ClawWin2.0/
├── custom-plugins/                    # 自定义插件根目录
│   ├── extensions/                    # 插件目录
│   │   ├── aliyun-opensearch-plugin/  # 阿里云 OpenSearch 搜索插件
│   │   │   ├── index.ts               # 入口文件（TypeScript）
│   │   │   ├── openclaw.plugin.json   # 插件 manifest
│   │   │   ├── package.json           # 包信息
│   │   │   └── src/                   # 源码目录
│   │   │       └── *.ts
│   │   │
│   │   └── memory-tencentdb-plugin/   # 腾讯云向量数据库记忆插件
│   │       ├── index.ts
│   │       ├── openclaw.plugin.json
│   │       ├── package.json
│   │       ├── bin/                   # CLI 工具
│   │       └── src/
│   │
│   ├── skills/                        # Skills 目录（可选）
│   │   └── your-skill-name/
│   │       └── SKILL.md               # Skill 定义文件
│   │
│   └── README.md                      # 本文档
│
├── bundled/openclaw/                  # OpenClaw 运行时目录
│   ├── dist/
│   │   ├── extensions/                # 编译后的插件目录
│   │   │   ├── aliyun-opensearch/     # 编译后的阿里云搜索插件
│   │   │   └── memory-tencentdb/      # 编译后的记忆插件
│   │   └── plugin-sdk/                # 插件 SDK
│   ├── skills/                        # Skills 目录
│   └── ...
│
└── scripts/
    ├── sync-custom-extensions.mjs     # 插件编译同步脚本
    └── prepare-openclaw.js            # OpenClaw 安装脚本
```

## 快速开始

### 1. 前置条件

确保已安装 OpenClaw 到 [bundled]() 目录：

### 2. 编译并同步插件

```powershell
# 编译所有插件和 skills
node scripts/sync-custom-extensions.mjs

# 只编译所有插件
node scripts/sync-custom-extensions.mjs extensions

# 只同步所有 skills
node scripts/sync-custom-extensions.mjs skills

# 编译指定插件
node scripts/sync-custom-extensions.mjs aliyun-opensearch-plugin
node scripts/sync-custom-extensions.mjs memory-tencentdb-plugin
```

### 3. 启用插件

编译后，需要在 OpenClaw 配置中启用插件。配置文件位于：

- Windows: `%USERPROFILE%\.openclaw\openclaw.json`
- macOS/Linux: `~/.openclaw/openclaw.json`

编辑配置文件，在 `plugins.entries` 中添加插件配置：

```json
{
  "plugins": {
    "entries": {
      "aliyun-opensearch": {
        "enabled": true,
        "config": {
          "integrationName": "aliyun",
          "queryRewrite": true,
          "contentType": "summary",
          "topK": 5
        }
      },
      "memory-tencentdb": {
        "enabled": true,
        "config": {
          "storeBackend": "sqlite",
          "capture": {
            "enabled": true
          },
          "recall": {
            "enabled": true,
            "maxResults": 5
          },
          "embedding": {
            "enabled": true,
            "provider": "openai",
            "baseUrl": "https://api.openai.com/v1",
            "apiKey": "your-api-key",
            "model": "text-embedding-3-small",
            "dimensions": 1536
          }
        }
      }
    }
  }
}
```

### 4. 重启应用

重启 ClawWin 应用，插件将自动加载。

## 插件文件说明

### index.ts（入口文件）

插件入口文件导出一个默认函数，接收 `OpenClawPluginApi` 对象：

```typescript
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'

export default function (api: OpenClawPluginApi) {
  // 注册工具
  api.registerTool({
    name: 'my_tool',
    description: '我的自定义工具',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '查询内容' }
      },
      required: ['query']
    },
    async execute(toolCallId, params) {
      // 工具逻辑
      return {
        content: [{ type: 'text', text: '结果...' }]
      }
    }
  })

  // 注册生命周期钩子
  api.on('agent_end', async (event, ctx) => {
    // Agent 结束后的处理逻辑
  })

  // 注册 CLI 命令（可选）
  api.registerCli(({ program }) => {
    program.command('my-command')
      .description('我的自定义命令')
      .action(() => { /* ... */ })
  })
}
```

### openclaw.plugin.json（插件 Manifest）

```json
{
  "id": "my-plugin",
  "activation": {
    "onStartup": false
  },
  "name": "我的插件",
  "description": "插件功能描述",
  "version": "1.0.0",
  "author": "Your Name",
  "license": "MIT",
  "keywords": ["openclaw", "plugin"],
  "contracts": {
    "tools": ["my_tool"]
  },
  "configSchema": {
    "type": "object",
    "properties": {
      "apiKey": {
        "type": "string",
        "description": "API 密钥"
      },
      "enabled": {
        "type": "boolean",
        "default": true,
        "description": "是否启用"
      }
    }
  }
}
```

**重要字段说明：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 插件唯一标识，用于配置和加载 |
| `activation` | object | **是** | 控制插件激活时机，必须包含 `onStartup` 字段 |
| `activation.onStartup` | boolean | 是 | 是否在启动时自动激活，通常设为 `false` |
| `name` | string | 是 | 插件显示名称 |
| `description` | string | 是 | 插件功能描述 |
| `version` | string | 是 | 插件版本号 |
| `contracts` | object | 推荐 | 声明插件提供的工具和能力，如 `tools`、`webSearchProviders` 等 |
| `kind` | string | 可选 | 插件类型，如 `memory` 表示记忆插件 |
| `configSchema` | object | 否 | 配置 JSON Schema，用于验证用户配置 |

**⚠️ 重要提示：`activation` 字段是必需的！**

如果缺少 `activation` 字段，OpenClaw 可能无法正确发现和加载插件。请确保每个自定义插件的 manifest 都包含：

```json
{
  "activation": {
    "onStartup": false
  }
}
```

### package.json

```json
{
  "name": "@openclaw/my-plugin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "插件描述",
  "author": "Your Name",
  "license": "MIT",
  "openclaw": {
    "extensions": ["./index.ts"]
  }
}
```

## 已有插件说明

### aliyun-opensearch-plugin

阿里云 OpenSearch 联网搜索插件，提供实时网络搜索能力。

**功能：**
- 实时网络搜索
- 智能查询重写
- 多轮对话上下文支持
- 通过后端接口获取凭证

**配置示例：**

```json
{
  "aliyun-opensearch": {
    "enabled": true,
    "config": {
      "integrationName": "aliyun",
      "queryRewrite": true,
      "contentType": "summary",
      "topK": 5
    }
  }
}
```

### memory-tencentdb-plugin

四层记忆系统插件，自动捕获、结构化和分析对话知识。

**功能：**
- L0: 自动对话记录（本地 JSONL）
- L1: 结构化记忆提取（LLM + 去重）
- L2: 场景块管理（LLM 场景提取）
- L3: 用户画像生成（LLM 画像合成）
- 向量搜索支持（SQLite-vec 或腾讯云向量数据库）

**配置示例：**

```json
{
  "memory-tencentdb": {
    "enabled": true,
    "config": {
      "storeBackend": "sqlite",
      "capture": {
        "enabled": true,
        "excludeAgents": ["bench-judge-*"]
      },
      "extraction": {
        "enabled": true,
        "enableDedup": true,
        "maxMemoriesPerSession": 20
      },
      "recall": {
        "enabled": true,
        "maxResults": 5,
        "strategy": "hybrid"
      },
      "embedding": {
        "enabled": true,
        "provider": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "your-api-key",
        "model": "text-embedding-3-small",
        "dimensions": 1536
      }
    }
  }
}
```

## Skills 文件说明

Skill 是纯 Markdown 文件，用于定义 Agent 能力：

```
custom-plugins/skills/my-skill/
└── SKILL.md
```

```markdown
# my-skill

## 描述
Skill 的功能描述

## 使用场景
- 场景 1
- 场景 2

## 参数
| 参数 | 类型 | 描述 |
|------|------|------|
| param1 | string | 参数描述 |

## 示例
使用示例...
```

## 开发流程

1. **创建插件目录**
   ```powershell
   # 在 custom-plugins/extensions/ 下创建新目录
   mkdir custom-plugins/extensions/my-plugin
   ```

2. **编写插件代码**
   - 创建 `index.ts` 入口文件
   - 创建 `openclaw.plugin.json` manifest
   - 创建 `package.json` 包信息
   - 在 `src/` 目录下编写源码

3. **编译插件**
   ```powershell
   node scripts/sync-custom-extensions.mjs my-plugin
   ```

4. **配置启用**
   编辑 `~/.openclaw/openclaw.json`，添加插件配置

5. **测试验证**
   重启应用，检查日志确认插件加载成功

## 命令汇总

| 命令 | 说明 |
|------|------|
| `node scripts/prepare-openclaw.js` | 安装/更新 OpenClaw 到 bundled 目录 |
| `node scripts/sync-custom-extensions.mjs init` | 初始化目录结构 |
| `node scripts/sync-custom-extensions.mjs` | 编译所有插件和 skills |
| `node scripts/sync-custom-extensions.mjs extensions` | 只编译所有插件 |
| `node scripts/sync-custom-extensions.mjs skills` | 只同步所有 skills |
| `node scripts/sync-custom-extensions.mjs <name>` | 编译指定插件或 skill |

## 常见问题

### Q: 插件编译失败，提示找不到 openclaw/plugin-sdk

确保已运行 `node scripts/prepare-openclaw.js` 安装 OpenClaw。

### Q: 插件加载失败，提示配置错误

检查 `openclaw.plugin.json` 的 `configSchema` 是否正确，确保用户配置符合 Schema 定义。

### Q: 如何调试插件？

查看 OpenClaw 日志输出，插件加载时会打印注册信息：
```
[my-plugin] Plugin registered successfully
```

### Q: 如何更新插件？

1. 修改源码
2. 运行 `node scripts/sync-custom-extensions.mjs <plugin-name>`
3. 重启应用

## 注意事项

- TypeScript 文件会被编译为 JavaScript
- 编译产物放在 `bundled/openclaw/dist/extensions/<plugin-id>/`
- **插件依赖会自动安装到 `bundled/openclaw/node_modules/`**
- Native 模块（如 `@node-rs/jieba`、`sqlite-vec`）需要特殊处理，脚本会自动安装
- 修改插件后需要重新运行编译脚本
- Skills 是纯文件复制，不需要编译
- 插件 ID 由 `openclaw.plugin.json` 的 `id` 字段决定，不是目录名

## 依赖管理

如果插件有外部依赖（在 `package.json` 的 `dependencies` 中声明），脚本会自动安装它们到 `bundled/openclaw/node_modules/`。

**支持的依赖类型：**
- 普通 npm 包（自动安装）
- Native 模块（如 `@node-rs/jieba`、`sqlite-vec`）- 自动安装
- Peer dependencies - 不安装，假设由 OpenClaw 提供

**手动安装依赖：**
```powershell
npm install <package-name> --prefix bundled/openclaw
```