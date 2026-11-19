module.exports = {
  apps: [{
    name: 'lingmi',
    script: 'dist/main.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'development',
      APP_PORT: 25109,
    },
    env_production: {
      NODE_ENV: 'production',
      APP_PORT: 25109,
    },
  }],
};
