// 세무 정보 게시글 SEO: 글마다 고유 주소(/column/분류/번호-제목)와
// 검색엔진이 자바스크립트 없이도 읽을 수 있는 HTML(제목·설명·본문·SEO 태그), 사이트맵을 만든다.
// public/index.html 을 틀로 쓰고, 필요한 부분만 글 내용으로 바꿔 끼운다.

export const SITE_URL = 'https://myhoteltax.com'
export const BRAND = '명륜세무회계'
const DEFAULT_IMAGE = SITE_URL + '/assets/logo.png'
const LIST_TITLE = `세무 정보 | ${BRAND}`
const LIST_DESC = '호텔·숙박업 사장님을 위한 세무 소식과 절세 정보를 전해드립니다. 창업·사업자등록, 부가가치세, 인건비·노무, 정부지원금, 세법개정 소식까지.'

// 카테고리 (public/index.html 의 CATEGORIES 와 같게 유지): 이름 → 주소용 영문, 카드 표시용 영문·아이콘
export const CATEGORIES = [
  { name: '창업·사업자등록', slug: 'startup', en: 'STARTUP', icon: 'fa-store' },
  { name: '부가가치세', slug: 'vat', en: 'VAT', icon: 'fa-receipt' },
  { name: '인건비·노무', slug: 'labor', en: 'LABOR', icon: 'fa-users' },
  { name: '정부지원금·정책자금', slug: 'subsidy', en: 'SUBSIDY', icon: 'fa-hand-holding-dollar' },
  { name: '세법개정·시사', slug: 'tax-news', en: 'TAX NEWS', icon: 'fa-newspaper' }
]
const catInfo = (name) =>
  CATEGORIES.find(c => c.name === name) || { name: name || '세무 정보', slug: 'general', en: 'TAX INSIGHT', icon: 'fa-file-lines' }
export const categorySlug = (name) => catInfo(name).slug

// 제목 → 주소용 글자 (한글·영문·숫자만 남기고 나머지는 '-')
export function slugify(title) {
  const s = String(title || '').normalize('NFC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return s || 'post'
}
// 글 주소: /column/{분류}/{번호}-{제목}. 번호가 있어 제목이 같아도 겹치지 않고, 제목을 고쳐도 옛 주소로 찾아감
export const postPath = (post) =>
  `/column/${categorySlug(post.category)}/${post.id}-${encodeURIComponent(slugify(post.title))}`
export function postIdFromSlug(slug) {
  let s = String(slug || '')
  try { s = decodeURIComponent(s) } catch (e) { /* 그대로 */ }
  const m = s.match(/^(\d+)(?:-|$)/)
  return m ? m[1] : null
}

// --- 게시판 DB(Supabase) 읽기: 공개용 키로 '등록(published)'된 글만 ---
// (* = id·title·content·created_at·category·status, seo_title·seo_description 칸을 만들었으면 그것도)
const POST_FIELDS = '*'
// 잠깐의 네트워크 오류·지연에 SEO 태그 없는 페이지가 나가지 않도록 8초 안에 못 받으면 한 번 더
const DB_TIMEOUT_MS = 8000
async function readPosts(db, query) {
  let lastError
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), DB_TIMEOUT_MS)
    try {
      const res = await fetch(`${db.url}/rest/v1/posts?${query}`, {
        headers: { apikey: db.key, Accept: 'application/json' }, signal: ctrl.signal
      })
      if (!res.ok) throw new Error('posts ' + res.status)
      return await res.json()
    } catch (e) {
      lastError = e
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError
}
export async function getPost(db, id) {
  if (!/^\d+$/.test(String(id))) return null
  const rows = await readPosts(db, `select=${POST_FIELDS}&id=eq.${id}&status=eq.published&limit=1`)
  return rows[0] || null
}
export async function listPosts(db, withContent = true) {
  const fields = withContent ? POST_FIELDS : 'id,title,created_at,category'
  return readPosts(db, `select=${fields}&status=eq.published&order=created_at.desc&limit=500`)
}

// --- 글자 처리 ---
export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
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
// 편집기 전용 블록(링크 카드·사진 자리)·버튼 걷어낸 본문 → 순수 글자
const stripWidgets = (html) => String(html || '')
  .replace(/<div class="(?:link-card|photo-slot)"[\s\S]*?<\/div>/gi, ' ')
  .replace(/<button\b[\s\S]*?<\/button>/gi, ' ')
export function htmlToText(html) {
  return decodeEntities(stripWidgets(html)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|td|th|blockquote)>/gi, ' ')
    .replace(/<[^>]+>/g, ''))
    .replace(/[​-‍⁠﻿]/g, '')   // 네이버 글에 섞인 보이지 않는 글자
    .replace(/\s+/g, ' ').trim()
}
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trim() + '…' : s)
// 검색 제목·설명: 글쓰기에서 직접 넣은 값(seo_title·seo_description), 없으면 글 제목 / 본문 앞 약 150자(사진·빈 줄 건너뜀)
// (public/index.html 의 postSeo 와 같게 유지)
export const SEO_DESC_LEN = 150
export function postSeo(post) {
  const title = String(post.title || '').trim()
  return {
    title: String(post.seo_title || '').trim() || title,
    desc: String(post.seo_description || '').trim() || clip(htmlToText(post.content), SEO_DESC_LEN) || `${title} - ${BRAND}`
  }
}
const toHttps = (u) => {
  try {
    const url = new URL(u, SITE_URL)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.protocol = 'https:'
    return url.toString()
  } catch (e) { return '' }
}
// 대표 이미지: 본문의 첫 사진 (링크 카드 로고 제외)
export function firstImage(html) {
  const m = stripWidgets(html).match(/<img\b[^>]*\bsrc\s*=\s*"([^"]+)"/i)
  return m ? toHttps(decodeEntities(m[1])) : ''
}
// 상세 본문: 편집기 버튼 제거 + alt 없는 사진에 '제목 이미지 N' alt
export function prepareContent(html, title) {
  let n = 0
  return String(html || '')
    .replace(/<button\b[\s\S]*?<\/button>/gi, '')
    .replace(/<img\b([^>]*)>/gi, (m, attrs) => {
      n++
      if (/\balt\s*=\s*"[^"]+"/i.test(attrs)) return m
      const rest = attrs.replace(/\salt\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/i, '')
      return `<img alt="${escapeHtml(`${title} 이미지 ${n}`)}"${rest}>`
    })
}
// 날짜: 한국 시간 기준 YYYY.MM.DD
function fmtDate(iso) {
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const k = new Date(d.getTime() + 9 * 3600 * 1000)
  const p = (x) => String(x).padStart(2, '0')
  return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())}`
}
const isoDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toISOString() }
// <script> 안에 넣어도 안전한 JSON
const scriptJson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c')

// --- <head> SEO 태그 ---
function seoTags({ title, desc, url, image, type, published, section, robots }) {
  const t = escapeHtml(title), d = escapeHtml(desc), u = escapeHtml(url), i = escapeHtml(image)
  return [
    robots ? `<meta name="robots" content="${robots}" />` : '',
    `<link rel="canonical" href="${u}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:site_name" content="${BRAND}" />`,
    `<meta property="og:locale" content="ko_KR" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${u}" />`,
    `<meta property="og:image" content="${i}" />`,
    published ? `<meta property="article:published_time" content="${published}" />` : '',
    section ? `<meta property="article:section" content="${escapeHtml(section)}" />` : '',
    `<meta name="twitter:card" content="${image === DEFAULT_IMAGE ? 'summary' : 'summary_large_image'}" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${i}" />`
  ].filter(Boolean).join('\n  ')
}

// 틀의 한 부분 바꾸기 (틀이 바뀌어 못 찾으면 그대로 두고 로그만)
function swap(html, search, replacement) {
  if (!html.includes(search)) { console.warn('[column] 틀에서 찾지 못함:', search.slice(0, 60)); return html }
  return html.replace(search, () => replacement)
}
function setHead(html, title, desc, extra) {
  html = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(title)}</title>`)
  html = html.replace(/<meta name="description"[^>]*>/i, () =>
    `<meta name="description" content="${escapeHtml(desc)}" />\n  ${extra}`)
  return html
}
// 게시판 화면으로 열기. 첫 화면(히어로)의 큰 제목 <h1> 은 숨겨져 있어도 h1 이 두 개가 되므로 <p> 로 (글 제목만 h1)
const boardMode = (html) => swap(html, '<body>', '<body class="board-mode">')
  .replace(/<h1>([\s\S]*?)<\/h1>/, (m, inner) => `<p class="hero-title">${inner}</p>`)

// --- 글 한 편 페이지 ---
export function renderPostPage(template, post) {
  const title = String(post.title || '').trim()   // 화면의 글 제목(h1)
  const url = SITE_URL + postPath(post)
  const seo = postSeo(post)                        // 검색 제목·설명 (<title>·description·og)
  const desc = seo.desc
  const image = firstImage(post.content) || DEFAULT_IMAGE
  const published = isoDate(post.created_at)
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: clip(title, 110),
    description: desc,
    image: [image],
    datePublished: published,
    dateModified: published,
    author: { '@type': 'Organization', name: BRAND, url: SITE_URL },
    publisher: { '@type': 'Organization', name: BRAND, logo: { '@type': 'ImageObject', url: DEFAULT_IMAGE } },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    articleSection: post.category || '세무 정보',
    inLanguage: 'ko-KR'
  }
  const pageTitle = `${seo.title} | ${BRAND}`
  const head = seoTags({ title: pageTitle, desc, url, image, type: 'article', published, section: post.category }) +
    `\n  <script type="application/ld+json">${scriptJson(article)}</script>` +
    `\n  <script>window.__SSR__ = ${scriptJson({ type: 'post', post })};</script>`

  let html = setHead(template, pageTitle, desc, head)
  html = boardMode(html)
  html = swap(html, '<div class="cat-filter" id="catFilter" aria-label="카테고리 필터"></div>',
    '<div class="cat-filter" id="catFilter" aria-label="카테고리 필터" style="display:none"></div>')
  html = swap(html, '<div id="boardList">', '<div id="boardList" style="display:none">')
  html = swap(html, '<div id="boardDetail" style="display:none">', '<div id="boardDetail">')
  html = swap(html, '<h1 id="detailTitle"></h1>', `<h1 id="detailTitle">${escapeHtml(title)}</h1>`)
  html = swap(html, '<div class="post-meta" id="detailMeta"></div>',
    `<div class="post-meta" id="detailMeta">${post.category ? `<span class="cat-badge">${escapeHtml(post.category)}</span>` : ''}` +
    `<i class="far fa-calendar"></i> <time datetime="${published}">${fmtDate(post.created_at)}</time></div>`)
  html = swap(html, '<div class="post-body" id="detailBody"></div>',
    `<div class="post-body ql-editor" id="detailBody">${prepareContent(post.content, title)}</div>`)
  return html
}

// --- 목록 카드 (검색엔진이 따라갈 수 있게 <a href> 로) ---
function listCard(post) {
  const cat = catInfo(post.category)
  const img = firstImage(post.content)
  const thumb = img
    ? `<div class="post-thumb"><img src="${escapeHtml(img)}" alt="${escapeHtml(post.title)}" loading="lazy" /></div>`
    : `<div class="post-thumb is-fallback"><span class="thumb-icon"><i class="fas ${cat.icon}" aria-hidden="true"></i></span>` +
      `<span class="thumb-name">${escapeHtml(cat.name)}</span><span class="thumb-en">${escapeHtml(cat.en)}</span></div>`
  return `<li class="post-card"><a class="post-card-link" href="${escapeHtml(postPath(post))}">${thumb}` +
    `<div class="post-card-body">${post.category ? `<span class="cat-badge">${escapeHtml(post.category)}</span>` : ''}` +
    `<h3>${escapeHtml(post.title)}</h3>` +
    `<div class="post-meta"><i class="far fa-calendar"></i> ${fmtDate(post.created_at)}</div>` +
    `<p class="post-excerpt">${escapeHtml(clip(htmlToText(post.content), 140))}</p></div></a></li>`
}

// --- 목록 페이지 (/column) ---
export function renderListPage(template, posts) {
  const url = SITE_URL + '/column'
  const head = seoTags({ title: LIST_TITLE, desc: LIST_DESC, url, image: DEFAULT_IMAGE, type: 'website' })
  let html = setHead(template, LIST_TITLE, LIST_DESC, head)
  html = boardMode(html)
  html = swap(html, '<div class="board-loading" id="listLoading">', '<div class="board-loading" id="listLoading" style="display:none">')
  if (posts.length) {
    html = swap(html, '<ul class="post-list" id="postList" style="display:none"></ul>',
      `<ul class="post-list" id="postList" style="display:grid">${posts.map(listCard).join('')}</ul>`)
  } else {
    html = swap(html, '<div class="board-empty" id="listEmpty" style="display:none">', '<div class="board-empty" id="listEmpty">')
  }
  return html
}

// --- 없는 글 (404) ---
export function renderNotFound(template) {
  const title = `글을 찾을 수 없습니다 | ${BRAND}`
  let html = setHead(template, title, LIST_DESC, '<meta name="robots" content="noindex" />')
  html = boardMode(html)
  html = swap(html, '<div class="board-loading" id="listLoading">', '<div class="board-loading" id="listLoading" style="display:none">')
  html = swap(html, '<div class="board-empty" id="listEmpty" style="display:none"><i class="far fa-folder-open"></i>아직 등록된 세무 정보가 없습니다.</div>',
    '<div class="board-empty" id="listEmpty"><i class="far fa-folder-open"></i>요청하신 글을 찾을 수 없습니다. <a href="/column">세무 정보 목록으로</a></div>')
  return html
}

// --- sitemap.xml / robots.txt ---
const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export function renderSitemap(posts) {
  const day = (iso) => (isoDate(iso) || '').slice(0, 10)
  const urls = [
    { loc: SITE_URL + '/' },
    { loc: SITE_URL + '/column', lastmod: posts[0] ? day(posts[0].created_at) : '' },
    ...posts.map(p => ({ loc: SITE_URL + postPath(p), lastmod: day(p.created_at) }))
  ]
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n') +
    '\n</urlset>\n'
}
export const ROBOTS_TXT = `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${SITE_URL}/sitemap.xml
`
