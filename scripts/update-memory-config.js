/**
 * 更新 OpenClaw 配置，禁用内置 memory_search 工具
 * 这是修复腾讯长期记忆插件集成问题的关键步骤
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');

try {
  if (!fs.existsSync(configPath)) {
    console.error('Config file not found:', configPath);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  
  // 确保 agents.defaults 存在
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};
  
  // 关键修复：禁用内置 memory_search 工具
  // OpenClaw 的 memory_search 工具是通过 agents.defaults.memorySearch 配置控制的
  // 必须设置 enabled: false 才能真正禁用它
  config.agents.defaults.memorySearch = { enabled: false };
  
  // 更新时间戳
  if (!config.meta) config.meta = {};
  config.meta.lastTouchedAt = new Date().toISOString();
  
  // 写回配置文件
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  
  console.log('✅ Successfully updated config:');
  console.log('   agents.defaults.memorySearch.enabled = false');
  console.log('');
  console.log('This disables the built-in memory_search tool,');
  console.log('allowing the Tencent memory plugin (tdai_memory_search) to work properly.');
  console.log('');
  console.log('Please restart the application for changes to take effect.');
  
} catch (err) {
  console.error('Failed to update config:', err.message);
  process.exit(1);
}
