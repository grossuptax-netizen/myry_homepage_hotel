import { Hono } from 'hono'
// 빌드 타임에 index.html 을 문자열로 인라인 (Cloudflare Workers 런타임에는 fs 가 없으므로 import 사용)
import indexHtml from '../public/index.html?raw'
// @ts-ignore (일반 JS 모듈)
import { fetchLinkPreview } from './link-preview.js'

// 게시판(Supabase) 정보: public/index.html 과 같은 값 (공개용 키)
const SUPABASE_URL = 'https://kbkmlwtldpuwssooikcm.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_70Bak9NaZKYyi9BJPMXXPA_4C4T3toV'
const ADMIN_EMAIL = 'grossuptax@gmail.com'

const app = new Hono()

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
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY }
  })
  const user: any = who.ok ? await who.json() : null
  if (!user || String(user.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return c.json({ error: 'forbidden' }, 403)
  }
  const info = await fetchLinkPreview(c.req.query('url') || '')
  return c.json(info, info.error ? 400 : 200)
})

export default app
