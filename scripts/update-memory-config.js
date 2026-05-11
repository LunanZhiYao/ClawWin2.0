/**
 * 更新 OpenClaw 配置，禁用内置 memory_search 工具
 * 这是修复腾讯长期记忆插件集成问题的关键步骤
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');

function applyTencentLongTermMemoryPolicy(config) {
  if (!config.plugins || typeof config.plugins !== 'object') config.plugins = {};
  if (!config.plugins.entries || typeof config.plugins.entries !== 'object') config.plugins.entries = {};
  if (!config.plugins.entries['memory-tencentdb'] || typeof config.plugins.entries['memory-tencentdb'] !== 'object') {
    config.plugins.entries['memory-tencentdb'] = { enabled: true, config: {} };
  }
  config.plugins.entries['memory-tencentdb'].enabled = true;
  if ('hooks' in config.plugins.entries['memory-tencentdb']) {
    delete config.plugins.entries['memory-tencentdb'].hooks;
  }

  if (!config.hooks || typeof config.hooks !== 'object') config.hooks = {};
  if (!config.hooks.internal || typeof config.hooks.internal !== 'object') {
    config.hooks.internal = { enabled: true, entries: {} };
  }
  if (!config.hooks.internal.entries || typeof config.hooks.internal.entries !== 'object') {
    config.hooks.internal.entries = {};
  }
  config.hooks.internal.entries['session-memory'] = { enabled: false };

  if (!config.agents || typeof config.agents !== 'object') config.agents = {};
  if (!config.agents.defaults || typeof config.agents.defaults !== 'object') config.agents.defaults = {};
  config.agents.defaults.memorySearch = { enabled: false };

  if (Array.isArray(config.agents.list)) {
    for (const agent of config.agents.list) {
      if (!agent || typeof agent !== 'object') continue;
      agent.memorySearch = { enabled: false };
    }
  }
}

try {
  if (!fs.existsSync(configPath)) {
    console.error('Config file not found:', configPath);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  
  // 统一策略：不管创建多少个 agent，长期记忆都优先走腾讯插件
  applyTencentLongTermMemoryPolicy(config);
  
  // 更新时间戳
  if (!config.meta) config.meta = {};
  config.meta.lastTouchedAt = new Date().toISOString();
  
  // 写回配置文件
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  
  console.log('✅ Successfully updated config:');
  console.log('   memory-tencentdb.enabled = true');
  console.log('   hooks.internal.entries.session-memory.enabled = false');
  console.log('   agents.defaults.memorySearch.enabled = false');
  console.log('   agents.list[*].memorySearch.enabled = false');
  console.log('');
  console.log('This disables the built-in memory_search tool,');
  console.log('allowing the Tencent memory plugin (tdai_memory_search) to work properly.');
  console.log('');
  console.log('Please restart the application for changes to take effect.');
  
} catch (err) {
  console.error('Failed to update config:', err.message);
  process.exit(1);
}
