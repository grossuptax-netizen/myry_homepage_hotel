// Cloudinary 사진 저장 (서버 전용): 업로드 서명, 서버에서 직접 올리기, 외부 사진 가져오기
// 계정 정보는 환경변수(CLOUDINARY_CLOUD_NAME·CLOUDINARY_API_KEY·CLOUDINARY_API_SECRET)에서만 읽음
import { checkUrl } from './link-preview.js'

export const CLOUDINARY_FOLDER = 'myhoteltax'
const MAX_IMAGE_BYTES = 10 * 1024 * 1024   // Cloudinary 무료 요금제 사진 1장 한도
const FETCH_TIMEOUT_MS = 15000

// 환경변수 세 개가 모두 있으면 설정, 하나라도 없으면 null
export function cloudinaryConfig(env) {
  const cloudName = String((env && env.CLOUDINARY_CLOUD_NAME) || '').trim()
  const apiKey = String((env && env.CLOUDINARY_API_KEY) || '').trim()
  const apiSecret = String((env && env.CLOUDINARY_API_SECRET) || '').trim()
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null
}

// 서명: 파라미터를 이름순으로 'a=1&b=2' 로 이어 붙이고 API Secret 을 덧붙인 SHA-1
export async function signCloudinary(params, secret) {
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&') + secret
  const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(toSign))
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// 화면에서 직접 올릴 때 쓸 서명 (API Secret 은 내보내지 않음)
export async function uploadSignature(cfg) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = await signCloudinary({ folder: CLOUDINARY_FOLDER, timestamp }, cfg.apiSecret)
  return { cloudName: cfg.cloudName, apiKey: cfg.apiKey, folder: CLOUDINARY_FOLDER, timestamp, signature }
}

// 서버에서 Cloudinary 에 올리기. file: 사진 내용(Blob) 또는 사진 주소(문자열 → Cloudinary 가 직접 가져옴)
export async function uploadFromServer(cfg, file) {
  const s = await uploadSignature(cfg)
  const form = new FormData()
  form.append('file', file)
  form.append('api_key', s.apiKey)
  form.append('timestamp', s.timestamp)
  form.append('folder', s.folder)
  form.append('signature', s.signature)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`, { method: 'POST', body: form })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json || !json.secure_url) {
    throw new Error('Cloudinary 업로드 실패: ' + ((json && json.error && json.error.message) || `HTTP ${res.status}`))
  }
  return json.secure_url
}

// 외부 사진을 서버가 직접 내려받기 (네이버 등은 다른 사이트 주소(Referer)가 붙으면 막으므로, Referer 없이 일반 브라우저처럼 요청)
export async function fetchImage(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
      }
    })
    if (!res.ok) throw new Error(`사진 받기 실패: HTTP ${res.status}`)
    const type = (res.headers.get('content-type') || '').split(';')[0].trim()
    if (!/^image\//i.test(type)) throw new Error('사진이 아닌 응답: ' + (type || '형식 없음'))
    if (Number(res.headers.get('content-length') || 0) > MAX_IMAGE_BYTES) throw new Error('10MB 를 넘는 사진')
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error('10MB 를 넘는 사진')
    return new Blob([buf], { type })
  } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? '사진 받기 시간 초과' : (e && e.message) || String(e))
  } finally {
    clearTimeout(timer)
  }
}

// 네이버 사진은 화면용 작은 판(카페 type=w800, 블로그 w773·w80_blur 등)으로 오는 경우가 많음 → 더 큰 판 주소
// (카페 w1600: 원본이 더 작으면 원본 크기, 블로그 w966 이 가장 큼). 해당 없으면 주소 그대로
export function largerNaverImage(url) {
  try {
    const u = new URL(url)
    const want = /^cafeptthumb-phinf\.pstatic\.net$/i.test(u.hostname) ? 1600
      : /^(postfiles|mblogthumb-phinf)\.pstatic\.net$/i.test(u.hostname) ? 966 : 0
    const m = (u.searchParams.get('type') || '').match(/^w(\d+)/)
    if (!want || (m && Number(m[1]) >= want)) return url
    u.searchParams.set('type', 'w' + want)
    return u.toString()
  } catch (e) {
    return url
  }
}

// 외부 사진 → Cloudinary(myhoteltax). 1) 서버가 직접 받아서 올리기(네이버 사진은 큰 판부터) 2) 안 되면 Cloudinary 가 주소로 직접 가져오기
// 성공: { ok: true, url, via }  실패: { ok: false, error }
export async function importImage(cfg, rawUrl) {
  const u = checkUrl(rawUrl)
  if (!u) return { ok: false, error: '가져올 수 없는 주소입니다' }
  const errors = []
  for (const src of new Set([largerNaverImage(u.toString()), u.toString()])) {
    try {
      const blob = await fetchImage(src)
      return { ok: true, url: await uploadFromServer(cfg, blob), via: 'server' }
    } catch (e) {
      errors.push((e && e.message) || String(e))
    }
  }
  try {
    return { ok: true, url: await uploadFromServer(cfg, u.toString()), via: 'cloudinary' }
  } catch (e) {
    errors.push((e && e.message) || String(e))
  }
  return { ok: false, error: errors.join(' / ') }
}
