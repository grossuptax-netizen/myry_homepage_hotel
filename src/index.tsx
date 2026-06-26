import { Hono } from 'hono'
// 빌드 타임에 index.html 을 문자열로 인라인 (Cloudflare Workers 런타임에는 fs 가 없으므로 import 사용)
import indexHtml from '../public/index.html?raw'

const app = new Hono()

// 루트는 인라인된 index.html 반환
app.get('/', (c) => c.html(indexHtml))

export default app
