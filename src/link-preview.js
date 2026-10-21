// 링크 카드용 사이트 정보 가져오기: 주소 → 제목·설명·대표 이미지
// (브라우저에서는 다른 사이트 HTML 을 직접 읽을 수 없어 서버(Cloudflare Worker)에서 대신 읽음)

const MAX_BYTES = 600 * 1024   // HTML 앞부분만 읽음 (메타 태그는 <head> 에 있음)
const TIMEOUT_MS = 7000

// http(s) 공개 주소만 허용 (내부망·로컬 주소 차단)
export function checkUrl(raw) {
  let u
  try { u = new URL(String(raw || '').trim()) } catch (e) { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || /\.(localhost|local|internal)$/.test(h) || h.includes(':') || h.startsWith('[') ||
      /^(0|10|127)\./.test(h) || /^169\.254\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) {
    return null
  }
  return u
}

// 바이트 → 글자 (EUC-KR 같은 옛 한글 인코딩 사이트도 처리)
export function decodeHtml(buf, contentType) {
  const bytes = new Uint8Array(buf)
  let charset = (String(contentType || '').match(/charset=["']?([\w-]+)/i) || [])[1]
  if (!charset) {
    const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 4096))
    charset = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1]
  }
  charset = String(charset || 'utf-8').toLowerCase()
  if (/^(ms949|cp949|x-windows-949|uhc)$/.test(charset)) charset = 'euc-kr'   // 네이버 카페 등 (표준 이름은 euc-kr)
  try { return new TextDecoder(charset).decode(bytes) }
  catch (e) { return new TextDecoder('utf-8').decode(bytes) }
}

function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return named[e.toLowerCase()] ?? m
  })
}

function attr(tag, name) {
  const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'))
  return m ? (m[1] ?? m[2] ?? m[3]) : null
}

const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

function absolute(src, base) {
  if (!src) return ''
  try {
    const u = new URL(src, base)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    if (u.protocol === 'http:') u.protocol = 'https:'   // https 사이트에서 섞인 주소 경고 방지
    return u.toString()
  } catch (e) { return '' }
}

// HTML 에서 제목·설명·대표 이미지 찾기 (og: → twitter: → <title>/description → 아이콘)
export function parseLinkPreview(html, pageUrl) {
  const head = String(html || '').slice(0, 300000)
  const metas = {}
  for (const m of head.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0]
    const key = (attr(tag, 'property') || attr(tag, 'name') || attr(tag, 'itemprop') || '').toLowerCase()
    const content = attr(tag, 'content')
    if (key && content != null && !(key in metas)) metas[key] = decodeEntities(content).trim()
  }
  const titleTag = (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]
  const title = metas['og:title'] || metas['twitter:title'] || (titleTag ? decodeEntities(titleTag) : '')
  const desc = metas['og:description'] || metas['twitter:description'] || metas['description'] || ''
  let image = metas['og:image'] || metas['og:image:url'] || metas['og:image:secure_url'] ||
    metas['twitter:image'] || metas['twitter:image:src'] || ''
  if (!image) {
    // 대표 이미지가 없으면 사이트 아이콘 (apple-touch-icon → 가장 큰 icon)
    let best = null
    for (const m of head.matchAll(/<link\s[^>]*>/gi)) {
      const tag = m[0]
      const rel = (attr(tag, 'rel') || '').toLowerCase()
      const href = attr(tag, 'href')
      if (!href || !/(^|\s)(apple-touch-icon|icon)(\s|$)/.test(rel)) continue
      const size = parseInt((attr(tag, 'sizes') || '').split('x')[0], 10) || (rel.includes('apple') ? 180 : 16)
      if (!best || size > best.size) best = { href, size }
    }
    if (best) image = best.href
  }
  const base = new URL(pageUrl)
  return {
    url: base.toString(),
    title: clip(title, 200),
    desc: clip(desc, 300),
    domain: base.hostname.replace(/^www\./, ''),
    image: absolute(image ? decodeEntities(image) : '', base)
  }
}

async function readLimited(res, max) {
  if (!res.body) return new ArrayBuffer(0)
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  while (total < max) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  try { await reader.cancel() } catch (e) { /* 이미 끝남 */ }
  const out = new Uint8Array(Math.min(total, max))
  let off = 0
  for (const c of chunks) {
    const part = c.subarray(0, out.length - off)
    out.set(part, off)
    off += part.length
    if (off >= out.length) break
  }
  return out.buffer
}

// 주소를 실제로 열어 정보 가져오기. 실패하면 { error }
export async function fetchLinkPreview(rawUrl) {
  const u = checkUrl(rawUrl)
  if (!u) return { error: 'bad-url' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(u.toString(), {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MyungryunLinkCard/1.0; +https://myhoteltax.com)',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.5'
      }
    })
    if (!res.ok) return { error: 'http-' + res.status }
    const ct = res.headers.get('content-type') || ''
    let info
    if (/^image\//i.test(ct)) {
      info = { url: u.toString(), title: '', desc: '', domain: u.hostname.replace(/^www\./, ''), image: absolute(u.toString(), u) }
    } else {
      info = parseLinkPreview(decodeHtml(await readLimited(res, MAX_BYTES), ct), res.url || u.toString())
    }
    // 글자를 제대로 못 읽었으면(깨진 글자 �) 제목·설명은 비움 → 카드에는 도메인이 제목으로
    if (/�/.test(info.title)) info.title = ''
    if (/�/.test(info.desc)) info.desc = ''
    // 카드 주소·도메인은 사용자가 넣은 주소 기준 (이동 후 주소가 아니라)
    return { ...info, url: u.toString(), domain: u.hostname.replace(/^www\./, '') }
  } catch (e) {
    return { error: 'fetch-failed' }
  } finally {
    clearTimeout(timer)
  }
}
