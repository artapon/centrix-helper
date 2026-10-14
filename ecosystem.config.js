module.exports = {
  apps : [{
    name: 'MedInt API',
    script: 'server.js',
    instances: 1,
    exec_mode : "fork_mode",
    autorestart: true,
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }],
};
