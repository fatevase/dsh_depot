import { setTimeout as delay } from 'node:timers/promises'
export class Github {
  constructor({ baseUrl = 'https://api.github.com', token, retries = 2, cache = {} } = {}) { this.baseUrl = baseUrl; this.token = token; this.retries = retries; this.cache = cache }
  async request(endpoint, { etag, method = 'GET', body, headers = {} } = {}) {
    if (!endpoint.startsWith('/') || endpoint.startsWith('//')) throw new Error('GitHub endpoint must be relative')
    const cached = this.cache[endpoint]
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(this.baseUrl + endpoint, { method, headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...(cached?.etag && method === 'GET' ? { 'if-none-match': etag ?? cached.etag } : {}), ...headers }, ...(body !== undefined ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) })
      if (response.status === 304 && cached) return { ...cached, notModified: true }
      if ((response.status === 429 || response.status >= 500) && attempt < this.retries) { await response.arrayBuffer(); await delay(Math.min(2000, 200 * 2 ** attempt)); continue }
      if (!response.ok) { const error = new Error(`GitHub ${method} ${endpoint.split('?')[0]} returned ${response.status}`); error.status = response.status; throw error }
      const text = await response.text(), data = text ? JSON.parse(text) : null
      const result = { data, etag: response.headers.get('etag'), link: response.headers.get('link') }
      if (method === 'GET') this.cache[endpoint] = result
      return result
    }
  }
  async list(endpoint) {
    const items = []
    for (let page = 1; page <= 10; page++) {
      const result = await this.request(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
      const data = Array.isArray(result.data) ? result.data : result.data?.items
      if (!Array.isArray(data)) throw new Error(`Expected list from ${endpoint}`)
      items.push(...data)
      if (data.length < 100 || (result.link && !result.link.includes('rel="next"'))) break
    }
    return items
  }
  async text(repository, file, commit) {
    const endpoint = `/repos/${repository}/contents/${file.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(commit)}`
    const { data } = await this.request(endpoint)
    if (data?.encoding !== 'base64' || typeof data.content !== 'string') throw new Error(`Expected file: ${file}`)
    return Buffer.from(data.content, 'base64').toString('utf8')
  }
}
