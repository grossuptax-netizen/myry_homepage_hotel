// 네이버 카페·블로그 글을 주소로 읽어 본문 HTML 가져오기 (공개 글만)
// 복사·붙여넣기와 달리 화면에 띄우지 않은 사진도 실제 주소가 들어 있어, 스크롤 없이 사진까지 모두 가져올 수 있음
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const TIMEOUT_MS = 15000

// 주소 → { type: 'cafe', cafe, byId, articleId } | { type: 'blog', blogId, logNo } | null
export function parseNaverUrl(raw) {
  let u
  try { u = new URL(String(raw || '').trim()) } catch (e) { return null }
  const host = u.hostname.toLowerCase().replace(/^m\./, '')
  if (host === 'cafe.naver.com') {
    // 새 주소: /ca-fe/cafes/{카페번호}/articles/{글번호}, /f-e/cafes/…, 모바일 /ca-fe/web/cafes/…
    let m = u.pathname.match(/\/cafes\/([A-Za-z0-9_-]+)\/articles\/(\d+)/)
    if (m) return { type: 'cafe', cafe: m[1], byId: /^\d+$/.test(m[1]), articleId: m[2] }
    // 옛 주소: ?iframe_url=/ArticleRead.nhn?clubid=…&articleid=… 또는 ArticleRead.nhn?clubid=…&articleid=…
    const inner = decodeURIComponent(u.searchParams.get('iframe_url_utf8') || u.searchParams.get('iframe_url') || '') + '&' + u.search
    const club = inner.match(/clubid=(\d+)/i)
    const art = inner.match(/articleid=(\d+)/i)
    if (club && art) return { type: 'cafe', cafe: club[1], byId: true, articleId: art[1] }
    // 짧은 주소: /{카페주소}/{글번호}
    m = u.pathname.match(/^\/([A-Za-z0-9_-]+)\/(\d+)\/?$/)
    if (m) return { type: 'cafe', cafe: m[1], byId: false, articleId: m[2] }
    return null
  }
  if (host === 'blog.naver.com') {
    const blogId = u.searchParams.get('blogId')
    const logNo = u.searchParams.get('logNo')
    if (blogId && /^\d+$/.test(logNo || '')) return { type: 'blog', blogId, logNo }
    const m = u.pathname.match(/^\/([A-Za-z0-9_-]+)\/(\d+)\/?$/)
    if (m) return { type: 'blog', blogId: m[1], logNo: m[2] }
  }
  return null
}

async function get(url, headers) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { headers: { 'User-Agent': UA, ...headers }, redirect: 'follow', signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return named[e.toLowerCase()] ?? m
  })
}

// html 에서 시작 표시(예: '<div class="se-main-container"')부터 짝이 맞는 </div> 까지 잘라내기
export function sliceBalancedDiv(html, startMarker) {
  const start = html.indexOf(startMarker)
  if (start < 0) return ''
  const re = /<\/?div\b[^>]*>/gi
  re.lastIndex = start
  let depth = 0
  let m
  while ((m = re.exec(html))) {
    depth += m[0][1] === '/' ? -1 : 1
    if (depth === 0) return html.slice(start, re.lastIndex)
  }
  return ''
}

async function fetchCafe(p) {
  const api = `https://apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes/${encodeURIComponent(p.cafe)}/articles/${p.articleId}?useCafeId=${p.byId}`
  const res = await get(api, { Referer: 'https://cafe.naver.com/', Accept: 'application/json' })
  const json = await res.json().catch(() => null)
  const article = json && json.result && json.result.article
  if (!res.ok || !article || !article.contentHtml) {
    const reason = (json && json.result && (json.result.reason || json.result.message)) || `HTTP ${res.status}`
    return { ok: false, error: `카페 글을 읽지 못했습니다 (${reason}). 회원만 볼 수 있는 글이면 이 방법을 쓸 수 없어요 — 네이버 글 화면에서 즐겨찾기의 ‘네이버 글 담기’ 버튼을 눌러 주세요 (설치 방법은 글쓰기 아래 ‘회원 전용 네이버 글 가져오기’).` }
  }
  // 원본 주소는 늘 같은 모양으로 (중복 글 찾기용): 카페 번호·글 번호
  const sourceUrl = `https://cafe.naver.com/ca-fe/cafes/${json.result.cafeId || p.cafe}/articles/${json.result.articleId || p.articleId}`
  return { ok: true, source: 'cafe', title: decodeEntities(article.subject), html: article.contentHtml, sourceUrl }
}

async function fetchBlog(p) {
  const url = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(p.blogId)}&logNo=${p.logNo}&redirect=Dlog&widgetTypeCall=true&directAccess=false`
  const res = await get(url, { Referer: 'https://blog.naver.com/', Accept: 'text/html' })
  if (!res.ok) return { ok: false, error: `블로그 글을 읽지 못했습니다 (HTTP ${res.status}).` }
  const page = await res.text()
  const body = sliceBalancedDiv(page, '<div class="se-main-container"')
  if (!body) return { ok: false, error: '블로그 글 본문을 찾지 못했습니다. 비공개 글이거나 예전 편집기로 쓴 글일 수 있어요.' }
  const title = (page.match(/<meta property="og:title" content="([^"]*)"/i) || [])[1] || ''
  return { ok: true, source: 'blog', title: decodeEntities(title), html: body, sourceUrl: `https://blog.naver.com/${p.blogId}/${p.logNo}` }
}

// 주소로 네이버 글 읽기. 성공: { ok, source, title, html, sourceUrl(늘 같은 모양의 원본 주소) }  실패: { ok: false, error }
export async function fetchNaverArticle(raw) {
  const p = parseNaverUrl(raw)
  if (!p) return { ok: false, error: '네이버 카페·블로그 글 주소가 아닙니다. 글을 연 상태의 주소창 주소를 붙여넣어 주세요.' }
  try {
    return p.type === 'cafe' ? await fetchCafe(p) : await fetchBlog(p)
  } catch (e) {
    return { ok: false, error: '네이버 글을 읽는 중 오류: ' + (e && e.name === 'AbortError' ? '시간 초과' : (e && e.message) || e) }
  }
}
