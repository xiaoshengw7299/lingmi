module.exports = {
    apps: [{
      name: 'lingmi-pay',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        APP_PORT: 25108,
      },
      env_production: {
        NODE_ENV: 'production',
        APP_PORT: 25108,
      },
    }],
  };
  