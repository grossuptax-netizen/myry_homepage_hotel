import { Hono } from 'hono'
import type { Context } from 'hono'
// 빌드 타임에 index.html 을 문자열로 인라인 (Cloudflare Workers 런타임에는 fs 가 없으므로 import 사용)
import indexHtml from '../public/index.html?raw'
// @ts-ignore (일반 JS 모듈)
import { fetchLinkPreview } from './link-preview.js'
// @ts-ignore (일반 JS 모듈)
import { cloudinaryConfig, uploadSignature, importImage } from './cloudinary.js'
// @ts-ignore (일반 JS 모듈)
import { fetchNaverArticle } from './naver-article.js'

// 게시판(Supabase) 정보: public/index.html 과 같은 값 (공개용 키)
const SUPABASE_URL = 'https://kbkmlwtldpuwssooikcm.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_70Bak9NaZKYyi9BJPMXXPA_4C4T3toV'
const ADMIN_EMAIL = 'grossuptax@gmail.com'

// 키는 코드에 쓰지 않고 .env 파일(GitHub 제외, 견본 .env.example)에 둠.
// Cloudflare 서버는 .env 를 직접 읽지 못하므로: 실제 사이트는 `npm run secrets:push` 로 .env 값을 비밀값(secret)으로 등록,
// 로컬은 `npm run preview` 가 .env 를 .dev.vars 로 복사해 씀 (scripts/env-sync.mjs)
type Bindings = {
  CLOUDINARY_CLOUD_NAME?: string
  CLOUDINARY_API_KEY?: string
  CLOUDINARY_API_SECRET?: string
}

const app = new Hono<{ Bindings: Bindings }>()

// 운영자 확인: 화면이 보낸 Supabase 로그인 토큰을 Supabase 에 물어 진짜인지·운영자 이메일인지 확인
// 실패하면 이유(reason)를 함께 돌려줘 화면 안내·서버 기록에 남김
async function checkAdmin(c: Context): Promise<{ ok: boolean; reason?: string }> {
  const auth = c.req.header('Authorization') || ''
  if (!/^Bearer\s+\S+/.test(auth)) return { ok: false, reason: '로그인 토큰이 없음' }
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY }
  })
  if (!who.ok) {
    const b: any = await who.json().catch(() => null)
    const why = `Supabase 가 로그인 토큰을 거절 (HTTP ${who.status}${b && (b.error_code || b.msg) ? ': ' + (b.error_code || b.msg) : ''})`
    console.warn('[admin] ' + why)
    return { ok: false, reason: why }
  }
  const user: any = await who.json()
  const email = String((user && user.email) || '').toLowerCase()
  if (email !== ADMIN_EMAIL) {
    console.warn('[admin] 운영자가 아닌 계정:', email)
    return { ok: false, reason: `운영자 계정이 아님 (${email || '이메일 없음'})` }
  }
  return { ok: true }
}
const needLogin = (reason?: string) => ({ ok: false, error: `운영자 로그인이 필요합니다.${reason ? ` (${reason})` : ''}` })

const NO_CLOUDINARY_KEYS = 'Cloudinary 환경변수(CLOUDINARY_CLOUD_NAME·CLOUDINARY_API_KEY·CLOUDINARY_API_SECRET)가 서버에 등록되지 않았습니다.'

// 루트는 인라인된 index.html 반환
app.get('/', (c) => c.html(indexHtml))

// Google Search Console 사이트 소유권 확인 파일 (정확한 경로에서 원문 그대로 반환)
app.get('/googlef151711fc2c45d18.html', (c) =>
  c.text('google-site-verification: googlef151711fc2c45d18.html')
)

// 링크 카드: 주소의 제목·설명·대표 이미지 (운영자 로그인 토큰이 있어야 사용 가능)
app.get('/api/link-preview', async (c) => {
  const auth = c.req.header('Authorization') || ''
  if (!/^Bearer\s+\S+/.test(auth)) return c.json({ error: 'login-required' }, 401)
  if (!(await checkAdmin(c)).ok) return c.json({ error: 'forbidden' }, 403)
  const info = await fetchLinkPreview(c.req.query('url') || '')
  return c.json(info, info.error ? 400 : 200)
})

// Cloudinary 업로드 서명 (운영자만): 카메라 버튼 등 파일을 화면에서 직접 올릴 때. 폴더 myhoteltax
app.post('/api/cloudinary/sign', async (c) => {
  const admin = await checkAdmin(c)
  if (!admin.ok) return c.json(needLogin(admin.reason), 401)
  const cfg = cloudinaryConfig(c.env)
  if (!cfg) return c.json({ ok: false, error: NO_CLOUDINARY_KEYS }, 503)
  return c.json({ ok: true, signed: true, ...(await uploadSignature(cfg)) })
})

// 외부 사진 가져오기 (운영자만): 붙여넣은 네이버 등 사진을 서버가 직접 받아 Cloudinary(myhoteltax)에 올리고 새 주소를 돌려줌
// 서버가 못 받으면 Cloudinary 가 주소에서 직접 가져오게 한 번 더 시도
app.post('/api/cloudinary/import', async (c) => {
  const admin = await checkAdmin(c)
  if (!admin.ok) return c.json(needLogin(admin.reason), 401)
  const cfg = cloudinaryConfig(c.env)
  if (!cfg) return c.json({ ok: false, error: NO_CLOUDINARY_KEYS }, 503)
  const body: any = await c.req.json().catch(() => ({}))
  const result = await importImage(cfg, body && body.url)
  return c.json(result, result.ok ? 200 : 502)
})

// 네이버 카페·블로그 글을 주소로 가져오기 (운영자만): 본문 HTML 을 돌려주면 화면이 붙여넣기와 같은 방식으로 넣음
// (복사·붙여넣기는 네이버 화면에 띄우지 않은 사진이 빈 그림으로 오지만, 이 방법은 사진 주소가 모두 들어 있음)
app.get('/api/naver/article', async (c) => {
  const admin = await checkAdmin(c)
  if (!admin.ok) return c.json(needLogin(admin.reason), 401)
  const result = await fetchNaverArticle(c.req.query('url') || '')
  return c.json(result, result.ok ? 200 : 400)
})

export default app
