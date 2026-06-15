// pm2 进程配置 — 用 .cjs 后缀避免 ESM 解析问题
module.exports = {
  apps: [{
    name: 'knowledge-tarot',
    script: 'server/index.js',
    cwd: '/opt/knowledge-tarot',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    // 内存超过 400MB 自动重启（防止内存泄漏拖死 2GB 小机器）
    max_memory_restart: '400M',
    env: {
      NODE_ENV: 'production',
      PORT: 3456
    },
    // 日志
    out_file: '/var/log/knowledge-tarot/out.log',
    error_file: '/var/log/knowledge-tarot/error.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    // 启动失败时的重试策略
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 3000
  }]
};
