module.exports = {
  apps: [{
    name: 'webapp',
    script: 'npx',
    args: 'http-server . -p 3000 -a 0.0.0.0 -c-1',
    cwd: '/home/user/webapp',
    env: { NODE_ENV: 'development' },
    watch: false,
    instances: 1,
    exec_mode: 'fork'
  }]
}
