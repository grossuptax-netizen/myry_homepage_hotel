// .env(Cloudinary 키 등 비밀값)를 서버가 쓸 수 있게 넘겨 주는 도구
// - 그냥 실행: .env → .dev.vars 복사 (로컬 `wrangler pages dev` 는 .dev.vars 를 읽음)
// - --push   : .env 의 Cloudinary 값을 Cloudflare Pages 비밀값(secret)으로 등록 (실제 사이트용)
// Cloudflare 서버는 실행 중에 .env 파일을 읽을 수 없어서, 실제 사이트는 비밀값으로 등록해야 함.
// .env·.dev.vars 는 .gitignore 에 있어 GitHub 에 올라가지 않음.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const PROJECT = 'myry-homepage-hotel'
const KEYS = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']

if (!existsSync('.env')) {
  console.log('[env] .env 파일이 없어 건너뜁니다. (.env.example 을 .env 로 복사해 값을 넣으세요)')
  process.exit(process.argv.includes('--push') ? 1 : 0)
}

// KEY=VALUE 줄 읽기 (# 주석·빈 줄 무시, 값의 앞뒤 따옴표 제거)
const vars = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  if (/^\s*#/.test(line)) continue
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
  if (m) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
}

if (process.argv.includes('--push')) {
  const missing = KEYS.filter((k) => !vars[k])
  if (missing.length) {
    console.error('[env] .env 에 값이 없습니다: ' + missing.join(', '))
    process.exit(1)
  }
  for (const k of KEYS) {
    // 값은 화면에 찍지 않고 표준입력으로만 넘김
    const r = spawnSync('npx', ['wrangler', 'pages', 'secret', 'put', k, '--project-name', PROJECT], {
      input: vars[k],
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: process.platform === 'win32'
    })
    if (r.status !== 0) {
      console.error(`[env] ${k} 등록 실패`)
      process.exit(r.status || 1)
    }
  }
  console.log('[env] Cloudflare Pages 비밀값 등록 완료: ' + KEYS.join(', ') + ' (다음 게시부터 적용)')
} else {
  writeFileSync('.dev.vars', Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
  console.log('[env] .env → .dev.vars 복사 (로컬 서버용)')
}
