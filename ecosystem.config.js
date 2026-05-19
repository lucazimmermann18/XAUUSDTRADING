module.exports = {
  apps: [{
    name:          'ict-sniper',
    script:        'server.js',
    instances:     1,
    autorestart:   true,
    watch:         false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
    },
    error_file:    'logs/err.log',
    out_file:      'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
