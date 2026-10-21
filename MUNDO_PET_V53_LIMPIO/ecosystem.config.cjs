module.exports = {
  apps: [{
    name: 'mundo-pet',
    script: './app.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '750M',
    time: true,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
