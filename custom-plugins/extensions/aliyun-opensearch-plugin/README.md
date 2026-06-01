# 阿里云 OpenSearch 插件

阿里云 OpenSearch 联网搜索插件，为 OpenClaw 提供实时网络搜索能力，支持智能查询重写和多轮对话上下文。

## 功能特性

- **实时网络搜索** — 获取最新的网页信息和搜索结果  
- **智能查询重写** — 使用 LLM 优化搜索查询词  
- **多轮对话上下文** — 支持传入对话历史，实现上下文感知搜索  
- **多种内容类型** — 支持 `snippet`（简短）与 `summary`（摘要）  
- **凭证与默认值** — 通过千易 integrations 凭证接口拉取 `api_key`、`host` 等；后端可返回 `content_type`（默认 `summary`）、`top_k`（默认 `5`）作为搜索默认值  
- **详细错误处理** — 提供清晰的错误提示  

## 安装

插件位于 `bundled/openclaw/extensions/aliyun-opensearch-plugin`，随 ClawWin / OpenClaw 内置加载。

## 配置

### 环境变量

- `ACCESS_TOKEN`：拉取集成凭证时使用的 Bearer Token（与登录 accessToken 同源）  
- `CLAWWIN_SERVER_URL`：服务根地址（凭证接口相对路径会拼到此地址）  
- `ALIYUN_OPENSEARCH_KEY_ENDPOINT`：可选，覆盖默认凭证接口路径  

### `openclaw.json` 示例

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
      }
    }
  }
}
```

`contentType`、`topK` 为插件侧默认：在**未**在工具调用里指定 `content_type` / `top_k` 时生效，且**优先于**后端凭证中的同名字段。若插件未配置，则使用后端返回的 `content_type` / `top_k`；后端缺省时分别为 `summary` 与 `5`。

### 后端 integrations 凭证 JSON

凭证接口返回的 JSON（或包在 `{ "code": 200, "data": { ... } }` 的 `data` 内）可包含：

```json
{
  "api_key": "OS-xxxxxxxx",
  "host": "http://default-xxx.platform-cn-shanghai.opensearch.aliyuncs.com",
  "workspace": "default",
  "service_id": "ops-web-search-001",
  "content_type": "summary",
  "top_k": 5
}
```

| 字段 | 说明 |
|------|------|
| `api_key` | OpenSearch Web Search API Key（必填） |
| `host` | 服务端点（必填） |
| `workspace` | 工作空间（必填） |
| `service_id` | 服务 ID（必填） |
| `content_type` | 可选，`snippet` 或 `summary`；缺省按 `summary` 解析 |
| `top_k` | 可选，数字或字符串，范围 1–10；缺省为 `5` |

## 工具 `aliyun_search` 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `query` | string | 是 | — | 搜索查询词 |
| `top_k` | number | 否 | 见上文 | 返回条数 1–10 |
| `query_rewrite` | boolean | 否 | `true` | 是否启用查询重写 |
| `content_type` | string | 否 | 见上文 | `snippet` 或 `summary` |
| `history` | array | 否 | — | 多轮对话历史 |

## 相关链接

- [阿里云联网搜索 API 参考](https://help.aliyun.com/zh/open-search/search-platform/developer-reference/web-search)

## 许可证

MIT
