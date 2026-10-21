import { Hono } from 'hono'
import type { Context } from 'hono'
// 빌드 타임에 index.html 을 문자열로 인라인 (Cloudflare Workers 런타임에는 fs 가 없으므로 import 사용)
import indexHtml from '../public/index.html?raw'
// @ts-ignore (일반 JS 모듈)
import { fetchLinkPreview } from './link-preview.js'

// 게시판(Supabase) 정보: public/index.html 과 같은 값 (공개용 키)
const SUPABASE_URL = 'https://kbkmlwtldpuwssooikcm.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_70Bak9NaZKYyi9BJPMXXPA_4C4T3toV'
const ADMIN_EMAIL = 'grossuptax@gmail.com'

// Cloudinary: 정육점 사이트(jung6tax.com)와 같은 계정, 이 사이트 사진은 'myhoteltax' 폴더로 구분
const CLOUDINARY_CLOUD_NAME = 'vxqu6qlr'
const CLOUDINARY_FOLDER = 'myhoteltax'
const CLOUDINARY_DEFAULT_PRESET = 'jung6tax_upload'   // 서명 키가 없을 때만 쓰는 공개(unsigned) preset

// Cloudflare 환경변수(비밀값): 젠스파크/Cloudflare 에서 등록
type Bindings = {
  CLOUDINARY_API_KEY?: string
  CLOUDINARY_API_SECRET?: string
  CLOUDINARY_UPLOAD_PRESET?: string
}

const app = new Hono<{ Bindings: Bindings }>()

// 운영자 확인: 화면이 보낸 Supabase 로그인 토큰으로 이메일을 확인
async function isAdminRequest(c: Context): Promise<boolean> {
  const auth = c.req.header('Authorization') || ''
  if (!/^Bearer\s+\S+/.test(auth)) return false
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY }
  })
  const user: any = who.ok ? await who.json() : null
  return !!user && String(user.email || '').toLowerCase() === ADMIN_EMAIL
}

// Cloudinary 서명: 파라미터를 이름순으로 'a=1&b=2' 로 이어 붙이고 API Secret 을 덧붙인 SHA-1
async function signCloudinary(params: Record<string, string>, secret: string): Promise<string> {
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&') + secret
  const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(toSign))
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

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
  if (!(await isAdminRequest(c))) return c.json({ error: 'forbidden' }, 403)
  const info = await fetchLinkPreview(c.req.query('url') || '')
  return c.json(info, info.error ? 400 : 200)
})

// Cloudinary 업로드 서명 (운영자만). 화면은 이 값으로 Cloudinary 에 직접 올림
// - API Key/Secret 이 등록돼 있으면: 서명 업로드 (운영자 외에는 올릴 수 없음), 폴더 myhoteltax
// - 등록돼 있지 않으면: 정육점 사이트처럼 공개 preset 업로드 (폴더 myhoteltax 지정)
app.post('/api/cloudinary/sign', async (c) => {
  if (!(await isAdminRequest(c))) return c.json({ ok: false, error: '운영자 로그인이 필요합니다.' }, 401)
  const env = c.env || {}
  const base = { ok: true, cloudName: CLOUDINARY_CLOUD_NAME, folder: CLOUDINARY_FOLDER }
  if (!env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    return c.json({ ...base, signed: false, uploadPreset: env.CLOUDINARY_UPLOAD_PRESET || CLOUDINARY_DEFAULT_PRESET })
  }
  const params = { folder: CLOUDINARY_FOLDER, timestamp: String(Math.floor(Date.now() / 1000)) }
  const signature = await signCloudinary(params, env.CLOUDINARY_API_SECRET)
  return c.json({ ...base, signed: true, apiKey: env.CLOUDINARY_API_KEY, timestamp: params.timestamp, signature })
})

export default app
