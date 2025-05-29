const MB = 1024 * 1024
// maximum number of namespaces that can be created in 24 hours, across all IPs
const MAX_GLOBAL_24 = 1000
// maximum number of namespaces that can be created in 24 hours, per IP
const MAX_IP_24 = 20
// maximum size of a namespace
const MAX_NAMESPACE_SIZE_MB = 200
const MAX_NAMESPACE_SIZE = MAX_NAMESPACE_SIZE_MB * MB
// maximum size of a value in bytes, this is a limitation of cloudflare KV
const MAX_VALUE_SIZE_MB = 25
const MAX_VALUE_SIZE = MAX_VALUE_SIZE_MB * MB
// minimum TTL for key is 1 minute, cloudflare limitation
const MIN_TTL = 60
// max TTL for key is 10 years
const MAX_TTL = 60 * 60 * 24 * 365 * 10
const MAX_KEY_SIZE = 2048

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    let path = new URL(request.url).pathname
    if (path.endsWith('/')) {
      path = path.slice(0, -1)
    }
    const match = path.match(/^\/([a-zA-Z0-9]{48})\/?(.*)$/)
    if (match) {
      const [_, namespace, key] = match
      if (key === '') {
        return await list(namespace, request, env)
      } else if (request.method === 'GET' || request.method === 'HEAD') {
        return await get(namespace, key, request, env)
      } else if (request.method === 'POST') {
        return await set(namespace, key, request, env)
      } else {
        return response405('GET', 'HEAD', 'POST')
      }
    } else if (path === '/create') {
      return await create(request, env)
    } else if (path === '') {
      return index(request)
    } else {
      return textResponse('Path not found', 404)
    }
  },
} satisfies ExportedHandler<Env>

async function get(namespace: string, key: string, request: Request, env: Env): Promise<Response> {
  const { value, metadata } = await env.cloudkvData.getWithMetadata<KVMetadata>(dataKey(namespace, key), 'stream')
  if (!value || !metadata) {
    // only check the namespace if the key does not exist
    const row = await env.DB.prepare('select 1 from namespaces where id=?').bind(namespace).first()
    return textResponse(row ? 'Key does not exist' : 'Namespace does not exist', 404)
  }
  return new Response(request.method === 'HEAD' ? '' : value, {
    headers: { 'Content-Type': metadata.content_type || 'application/octet-stream' },
  })
}

async function set(namespace: string, key: string, request: Request, env: Env): Promise<Response> {
  let content_type = request.headers.get('Content-Type')
  if (content_type) {
    content_type = content_type.split(';')[0]
  }
  if (key.length > MAX_KEY_SIZE) {
    return textResponse(`Key length must not exceed ${MAX_KEY_SIZE}`, 400)
  }

  let ttl: number = MAX_TTL
  const ttlHeader = request.headers.get('ttl')
  if (ttlHeader) {
    try {
      ttl = parseInt(ttlHeader)
    } catch (error) {
      return textResponse(`Invalid "TTL" header "${ttlHeader}": not a valid number`, 400)
    }
    // clamp ttl to valid range
    ttl = Math.max(MIN_TTL, Math.min(ttl, MAX_TTL))
  }

  const body = await request.arrayBuffer()
  const size = body.byteLength
  if (!size) {
    return textResponse('To set a key, the request body must not be empty', 400)
  }
  if (size > MAX_VALUE_SIZE) {
    return textResponse(`Value size must not exceed ${MAX_VALUE_SIZE_MB}MB`, 400)
  }

  let { nsExists, nsSize } = (await env.DB.prepare(
    `
select
  exists (select 1 from namespaces where id = ?) as nsExists,
  (
    select coalesce(sum(size), 0)
    from kv
    where namespace_id = ? and key != ? and expiration > datetime('now')
  ) as nsSize;
`,
  )
    .bind(namespace, namespace, key)
    .first<{ nsExists: number; nsSize: number }>())!

  if (!nsExists) {
    return textResponse('Namespace does not exist', 404)
  } else if (nsSize + size > MAX_NAMESPACE_SIZE) {
    return textResponse(`Namespace size limit of ${MAX_NAMESPACE_SIZE_MB}MB would be exceeded`, 400)
  }

  const { created_at, expiration } = (await env.DB.prepare(
    `
insert into kv
  (namespace_id, key, content_type, size, expiration)
values (?, ?, ?, ?, datetime('now', ?))
on conflict do update set
  content_type = excluded.content_type,
  size = excluded.size,
  created_at = datetime('now'),
  expiration = excluded.expiration
returning
  ${sqlIsoDate('created_at')} as created_at,
  ${sqlIsoDate('expiration')} as expiration
`,
  )
    .bind(namespace, key, content_type, size, `+${ttl} seconds`)
    .first<{ created_at: string; expiration: string }>())!

  await env.DB.prepare("delete from kv where namespace_id = ? and expiration < datetime('now')").bind(namespace).run()

  const metadata: KVMetadata = { content_type }
  const expirationDate = new Date(expiration)
  await env.cloudkvData.put(dataKey(namespace, key), body, {
    expiration: expirationDate.getTime() / 1000,
    metadata,
  })
  const url = new URL(request.url)
  url.search = ''
  url.hash = ''
  return jsonResponse({
    url,
    key,
    content_type: content_type,
    size,
    created_at,
    expiration,
  })
}

interface KVMetadata {
  content_type: string | null
}

interface DbRow {
  key: string
  content_type: string
  size: number
  created_at: string
  expiration: string
}

interface ListKey extends DbRow {
  url: string
}

interface ListResponse {
  keys: ListKey[]
}

async function list(namespace: string, request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') {
    return response405('GET')
  }

  const nsExists = await env.DB.prepare('select 1 from namespaces where id=?').bind(namespace).first()
  if (!nsExists) {
    return textResponse('Namespace does not exist', 404)
  }

  const url = new URL(request.url)
  const like = url.searchParams.get('like')
  let offset = 0
  let offsetParam = url.searchParams.get('offset')
  if (offsetParam) {
    try {
      offset = parseInt(offsetParam)
    } catch (error) {
      return textResponse('Invalid offset', 400)
    }
  }
  // clean the URL to use when building the key URL
  url.pathname = `/${namespace}`
  url.search = ''
  url.hash = ''

  const params = like ? [namespace, like, offset] : [namespace, offset]
  const result = await env.DB.prepare(
    `
select
  key,
  content_type,
  size,
  ${sqlIsoDate('created_at')} as created_at,
  ${sqlIsoDate('expiration')} as expiration
from kv
where namespace_id = ? and expiration > datetime('now') ${like ? `and key like ?` : ''}
order by created_at
limit 1000
offset ?
`,
  )
    .bind(...params)
    .all<DbRow>()
  const keys = result.results.map((row) => ({
    url: `${url}/${row.key}`,
    ...row,
  })) as ListKey[]

  const response: ListResponse = { keys }
  return jsonResponse(response)
}

async function create(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return response405('POST')
  }
  const ip = getIP(request)
  let { globalCount, ipCount } = (await env.DB.prepare(
    `
select
  count(*) as globalCount,
  count(case when ip = ? then 1 end) as ipCount
from namespaces
where created_at > datetime('now', '-24 hours')
  `,
  )
    .bind(ip)
    .first<{ globalCount: number; ipCount: number }>())!

  if (globalCount > MAX_GLOBAL_24) {
    return textResponse(`Global limit (${MAX_GLOBAL_24}) on namespace creation per 24 hours exceeded`, 429)
  } else if (ipCount > MAX_IP_24) {
    return textResponse(`IP limit (${MAX_IP_24}) on namespace creation per 24 hours exceeded`, 429)
  }

  let namespace = uniqueId()
  let { created_at } = (await env.DB.prepare(
    `insert into namespaces (id, ip) values (?, ?) returning ${sqlIsoDate('created_at')} as created_at`,
  )
    .bind(namespace, ip)
    .first<{ created_at: string }>())!
  return jsonResponse({ namespace, created_at })
}

function index(request: Request): Response {
  if (request.method === 'GET') {
    return new Response('<h1>Cloud KV</h1><p>See <a href="#">samuelcolvin/cloudkv</a> for details.</p>', {
      headers: ctHeader('text/html'),
    })
  } else if (request.method === 'HEAD') {
    return new Response('', { headers: ctHeader('text/html') })
  } else {
    return response405('GET', 'HEAD')
  }
}

const dataKey = (namespace: string, key: string) => `data:${namespace}:${key}`

const ctHeader = (contentType: string) => ({ 'Content-Type': contentType })

const textResponse = (message: string, status: number) =>
  new Response(message, { status, headers: ctHeader('text/plain') })
const jsonResponse = (data: any) =>
  new Response(JSON.stringify(data, null, 2) + '\n', { headers: ctHeader('application/json') })

const response405 = (...allowMethods: string[]) => {
  const allow = allowMethods.join(', ')
  return new Response(`Method not allowed, Allowed: ${allow}`, {
    status: 405,
    headers: { allow, ...ctHeader('text/plain') },
  })
}

const getIP = (request: Request): string => {
  const ip = request.headers.get('cf-connecting-ip')
  if (ip) {
    return ip
  } else {
    throw new Error('IP address not found')
  }
}
const sqlIsoDate = (field: string) => `strftime('%Y-%m-%dT%H:%M:%SZ', ${field})`

// this will always generate an alphanumeric string of 48 characters
function uniqueId(): string {
  const uint8Array = new Uint8Array(36)
  crypto.getRandomValues(uint8Array)
  // Convert Uint8Array to binary string
  const binaryString = String.fromCharCode.apply(null, Array.from(uint8Array))
  // Encode to base64, and replace `/` with 'a' and `+` with 'b' and `=` with 'c'
  // (this reduces entropy very slightly but makes the search easier to use)
  return btoa(binaryString).replaceAll('/', 'a').replaceAll('+', 'b').replaceAll('=', 'c')
}
