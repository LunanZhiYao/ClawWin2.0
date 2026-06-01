# Changelog

本文件记录 `@tencentdb-agent-memory/memory-tencentdb` 插件的所有显著变更，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/)。

---

## [0.2.2] - 2026-04-17

### 🐛 修复

- 修复因未声明 `undici` 依赖导致 TCVDB 客户端加载失败的问题（开发环境之前依赖 monorepo 根 `node_modules` 的传递解析）
- 将插件注册阶段的大量 INFO 日志降级为 DEBUG，避免 CLI 模式下输出过多无关日志

## [0.2.1] - 2026-04-16 (deprecated)

> NOTE: 此版本由于存在 undici 依赖导致插件启动失败的问题，已废弃
> 相关问题在 0.2.2 及以后版本中已修复

### 🚀 新功能

- TCVDB 新增 HTTPS 连接支持，可通过插件配置 `caPemPath` 或迁移脚本参数 `--tcvdb-ca-pem` 指定自定义 CA 证书 PEM 文件
- `read-local-memory` 脚本新增 L2 单文件查询，并将 L0 / L1 查询切换为直接从 `vectors.db` 读取，支持 SQL 层过滤、排序与分页

### ✨ 改进

- TCVDB 的 L0 / L1 向量索引默认调整为 `DISK_FLAT`，并在不支持该索引类型的实例上自动回退到 `HNSW`
- 默认服务端 embedding 模型调整为 `bge-large-zh`
- TCVDB 所有读接口统一启用 `readConsistency: "strongConsistency"`，消除 read-after-write 不一致
- 健康检测脚本 VDB 连接支持 HTTPS 自签证书

### 🐛 修复

- 修复 L3 persona sync 因未拉取远端 baseline 导致版本冲突跳过写入的问题
- 修复 `memories_since_last_persona` 被 L0 和 L1 双重计数导致 persona 触发阈值膨胀的问题
- 移除 `CheckpointManager` 中已被 `captureAtomically()` 替代的废弃方法

---

## [0.2.0] - 2026-04-15

### 🚀 新功能

**腾讯云向量数据库（TCVDB）存储后端**

- 新增腾讯云向量数据库存储后端，支持向量 + BM25 混合召回
- 支持 SQLite 与 TCVDB 之间的索引结构同步
- L2 场景 / L3 画像支持在本地缓存与向量数据库之间双向同步
- 插件配置（manifest）暴露 `storeBackend`、`tcvdb`、`bm25`、`embedding.timeoutMs` 等配置项

**本地 BM25 关键字检索**

- 使用本地 tcvdb-text 编码器替代原有的 BM25 HTTP sidecar 服务，消除外部依赖

**Seed 数据导入工具**

- 新增 CLI `seed` 命令，支持从外部数据批量导入记忆
- 提取共享的 pipeline-factory，供 seed 和正常运行时复用
- 支持 ISO 8601 时间戳格式（移除 JSONL 支持）

**数据迁移与运维工具**

- 新增 SQLite → 腾讯云向量数据库迁移脚本，支持 `--help` / `-h` 展示完整参数说明和使用示例
- 新增 VDB 数据导出脚本（含预编译 JS 和 CLI 启动器）
- 新增本地 Memory 数据查询脚本
- 注册全部 CLI bin 入口：`migrate-sqlite-to-tcvdb`、`export-tencent-vdb`、`read-local-memory`

**记忆搜索工具调用限制**

- `tdai_memory_search` + `tdai_conversation_search` 增加每轮合计最多 3 次的调用次数限制，通过 tool description 和召回引导提示词约束模型行为，防止陷入无效重复搜索

### 🐛 修复

- 修复 L2 场景合并（MERGE）无法删除旧文件的问题：OpenClaw 4.1+ 的 write 工具拒绝空白内容，改用 `[DELETED]` 标记实现软删除，SceneExtractor cleanup 阶段同步识别并清理
- 修复 L2 抽取产生孤立 BATCH/ARCHIVE 文件的问题，统一 maxScenes 上限为 15
- 修复 L3 启动时重复拉取 profile 的问题
- 过滤 skill wrapper 噪声标记（`¥¥[...]¥¥`）
- 处理 `createCollection` 并发竞态（错误码 15202）

### ♻️ 重构

- Pipeline checkpoint 游标语义从 timestamp 改为 update_at
- Runner 改用 `api.runtime.agent.runEmbeddedPiAgent`，避免跨环境导入失败
- 统一脚本构建流程：新增 `build:scripts` 一键编译命令，`prepack` 钩子确保 `npm pack` 前自动编译全部脚本产物

### 📚 文档

- 新增 AI Agent 长期记忆插件设计与实现技术文档
- 新增项目指南、研发系统分层架构文档
- 新增 VDB 存储设计文档及迁移指南

---

<details>
<summary>预发布版本</summary>

## [0.2.0-beta.1] - 2026-04-14

*此版本的内容已合并至 [0.2.0] 正式版。*

</details>

## [0.1.4] - 2026-04-10

### 🚀 Features

- *(auto-recall)* Add recall hint text before memories

## [0.1.3] - 2026-04-09

### 🚀 功能

- *(memory-tdai)* 用 reporter 抽象替换 emitMetric
- *(L3)* L3 使用读写工具，防止模型输出 CoT
- *(memory)* 添加 embedding 截断、召回超时，以及从 L0 捕获中剔除代码块
- *(config)* Embedding 超时支持配置
- *(report)* 在 schema 中暴露 report 配置项，默认值改为 false

### 🐛 修复

- *(capture)* 跳过心跳/定时任务/自动化/调度类消息
- *(recall)* 召回完成时清除超时定时器，避免误报超时警告

### 💼 Other

- 重命名包名为 memory-tencentdb
- *(deps)* 将 node-llama-cpp 改为可选依赖

### ⚡ 性能

- *(auto-capture)* 将 L0 向量嵌入移至后台以降低延迟

### 📚 文档

- 添加 allowPromptInjection 配置警告说明

## [0.1.2] — 2026-03-26

### 更新内容

1. 优化对话捕获与记忆抽取过滤机制

## [0.1.1] — 2026-03-25

### 更新内容

1. 兼容 openclaw 2026.3.23 更新

## [0.1.0] — 2026-03-25

> 首个正式发布版本。本地优先的四层记忆系统（L0→L1→L2→L3），基于 SQLite + LLM 实现对话捕获、记忆提取、场景归纳与用户画像。

### 更新内容

1. 关键字检索增加 FTS5 全文索引，采用 jieba 分词
2. 未配置远程 embedding 服务时，默认不开启 embedding 能力（不自动使用本地 embedding，且封禁主动使用本地 embedding 的配置入口）
3. 优化 L2、L3 生成 prompt 以控制生成内容大小（减少 token 开销）
4. Pipeline 调度器优化文件锁用法
5. 避免全量读取 L0、L1 数据
