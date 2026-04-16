# 阿里云 OpenSearch 插件

阿里云 OpenSearch 联网搜索插件，为 OpenClaw 提供实时网络搜索能力，支持智能查询重写和多轮对话上下文。

## 功能特性

- ✅ **实时网络搜索** - 获取最新的网页信息和搜索结果
- ✅ **智能查询重写** - 使用 LLM 优化搜索查询词，提高搜索质量
- ✅ **多轮对话上下文** - 支持传入对话历史，实现上下文感知搜索
- ✅ **多种内容类型** - 支持 `snippet`（简短摘要）和 `summary`（详细摘要）
- ✅ **灵活配置** - 支持环境变量和配置文件两种方式
- ✅ **详细错误处理** - 提供清晰的错误提示和故障排查建议
- ✅ **使用统计** - 返回 token 使用情况，便于成本控制

## 安装

### 方式一：作为内置插件（推荐）

插件已集成到 ClawWin 项目中，位于 `bundled/openclaw/extensions/aliyun-opensearch-plugin` 目录。

OpenClaw 启动时会自动加载此插件。

## 配置

### 环境变量方式（推荐）

在 ClawWin 项目的 `.env` 文件中配置：

```env
# 阿里云 OpenSearch API Key（必填）
ALIYUN_OPENSEARCH_API_KEY=OS-xxxxxxxxxxxx

# API 服务地址（可选，默认为华东2上海）
ALIYUN_OPENSEARCH_HOST=http://opensearch.cn-shanghai.aliyuncs.com
```

### 配置文件方式（可选）

在 `~/.openclaw/openclaw.json` 中添加：

```json
{
  "plugins": {
    "entries": {
      "aliyun-opensearch": {
        "enabled": true,
        "config": {
          "apiKey": "OS-xxxxxxxxxxxx",
          "host": "http://opensearch.cn-shanghai.aliyuncs.com",
          "workspace": "default",
          "serviceId": "ops-web-search-001",
          "queryRewrite": true,
          "contentType": "snippet",
          "topK": 5
        }
      }
    }
  }
}
```

**注意**：环境变量优先级高于配置文件。

## 获取 API Key

1. 登录 [阿里云控制台](https://ram.console.aliyun.com/manage/ak)
2. 进入 OpenSearch 服务
3. 在"API-KEY管理"中创建密钥
4. 复制 API Key 并配置到环境变量或配置文件中

详细文档：[阿里云联网搜索API参考](https://help.aliyun.com/zh/open-search/search-platform/developer-reference/web-search)

## 工具参数

### aliyun_search 工具

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| query | string | ✅ | - | 搜索查询词 |
| top_k | number | ❌ | 5 | 返回结果数量（1-10） |
| query_rewrite | boolean | ❌ | true | 是否启用 LLM 查询重写 |
| content_type | string | ❌ | snippet | 内容类型：snippet 或 summary |
| history | array | ❌ | - | 对话历史，用于多轮搜索 |

### content_type 说明

- **snippet**：网页内容的简短描述，速度快，适合快速浏览
- **summary**：网页内容的文本摘要，内容更详细，但耗时较长

### history 格式

```json
[
  {"role": "system", "content": "你是一个助手"},
  {"role": "user", "content": "浙江的省会是哪里"},
  {"role": "assistant", "content": "杭州"}
]
```

## 使用示例

### 基础搜索

```
帮我搜索最新的 AI 技术趋势
```

### 天气查询

```
北京今天的天气怎么样
```

### 新闻搜索

```
搜索最近一周关于云计算的新闻
```

### 多轮对话搜索

```
用户：浙江的省会是哪里？
AI：杭州
用户：那里今天的天气怎么样？
```

AI 会自动调用 `aliyun_search` 工具，并传入对话历史：
```json
{
  "query": "杭州今日天气",
  "history": [
    {"role": "user", "content": "浙江的省会是哪里"},
    {"role": "assistant", "content": "杭州"}
  ]
}
```

## 服务端点

根据你的阿里云区域选择对应的 host：

| 区域 | Host 地址 |
|------|-----------|
| 华东1(杭州) | `http://opensearch.aliyuncs.com` |
| 华东2(上海) | `http://opensearch.cn-shanghai.aliyuncs.com` |
| 华北2(北京) | `http://opensearch.cn-beijing.aliyuncs.com` |
| 华南1(深圳) | `http://opensearch.cn-shenzhen.aliyuncs.com` |

## API 限制

- **QPS 限制**：默认 3 QPS，超出需联系技术支持
- **Token 消耗**：启用查询重写会消耗额外 tokens
- **结果数量**：最多返回 10 条结果

## 返回示例

```markdown
## 搜索结果（共 5 条）

### 1. 杭州天气
今天夜里多云；明天晴到多云；后天多云到阴。今天夜里偏北风2-3级...
[查看详情](https://www.hzqx.com/pc/hztq/)

### 2. 杭州市天气预报_天气查询- 墨迹天气
杭州市今天实况：3度晴，湿度：66%，西北风：3级...
[查看详情](https://tianqi.moji.com/weather/china/zhejiang/hangzhou)

---
*搜索次数: 1 | 查询重写 tokens: 200*
```

## 故障排查

### API Key 未配置

```
阿里云 OpenSearch API Key 未配置
```

**解决**：检查 `.env` 文件中 `ALIYUN_OPENSEARCH_API_KEY` 是否设置正确。

### API Key 无效

```
API Key 无效或已过期，请检查配置
```

**解决**：检查 API Key 是否正确，是否过期。

### QPS 超限

```
请求频率超限（默认 QPS 限制为 3），请稍后重试
```

**解决**：降低请求频率，或联系阿里云技术支持提升 QPS 限制。

### 权限不足

```
权限不足或 QPS 超限，请检查 API Key 权限或联系技术支持
```

**解决**：检查 API Key 是否有 OpenSearch API 的调用权限。

### 网络错误

```
阿里云搜索失败: fetch failed
```

**解决**：检查网络连接，确认 host 地址正确。

### 插件未加载

如果 AI 无法调用搜索工具，请检查：

1. 确认插件文件存在于 `bundled/openclaw/extensions/aliyun-opensearch-plugin/`
2. 查看 OpenClaw 启动日志，确认插件注册成功
3. 重启 ClawWin 应用

## 技术实现

### 插件结构

```
aliyun-opensearch-plugin/
├── index.ts              # 插件入口和工具实现
├── package.json          # NPM 包配置
├── openclaw.plugin.json  # OpenClaw 插件元数据
├── tsconfig.json         # TypeScript 配置
└── README.md             # 本文档
```

### API 调用流程

1. 用户发起搜索请求
2. OpenClaw 调用 `aliyun_search` 工具
3. 工具向阿里云 OpenSearch API 发送请求
4. API 返回搜索结果
5. 工具格式化结果并返回给用户

### 类型定义

```typescript
interface SearchResult {
  title: string      // 网页标题
  link: string       // 网页链接
  snippet: string    // 网页摘要
  content?: string   // 网页内容
  position: number   // 结果位置
}

interface AliyunSearchResponse {
  result?: {
    search_result?: SearchResult[]
  }
  usage?: {
    search_count?: number
    rewrite_model?: {
      input_tokens?: number
      output_tokens?: number
      total_tokens?: number
    }
  }
}
```

## 相关链接

- [阿里云 OpenSearch 文档](https://help.aliyun.com/product/29873.html)
- [联网搜索API参考](https://help.aliyun.com/zh/open-search/search-platform/developer-reference/web-search)
- [ClawWin2.0 GitHub](https://github.com/wk42worldworld/ClawWin2.0)

## 许可证

MIT
