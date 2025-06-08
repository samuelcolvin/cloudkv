import * as logfire from '@pydantic/logfire-api'
import { instrument } from '@pydantic/logfire-cf-workers'

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

const handler = {
  async fetch(request, env, ctx): Promise<Response> {
    try {
      let path = new URL(request.url).pathname
      if (path.endsWith('/')) {
        path = path.slice(0, -1)
      }
      // 24 length matches the string resulting from random(18)
      const nsMatch = path.match(/^\/([a-zA-Z0-9]{24})\/?(.*)$/)
      if (nsMatch) {
        const [_, readToken, key] = nsMatch
        if (key === '') {
          return await list(readToken, request, env)
        } else if (request.method === 'GET' || request.method === 'HEAD') {
          return await get(readToken, key, request, env)
        } else if (request.method === 'POST') {
          return await set(readToken, key, request, env, ctx)
        } else if (request.method === 'DELETE') {
          return await del(readToken, key, request, env)
        } else {
          return response405('GET', 'HEAD', 'POST', 'DELETE')
        }
      } else if (path === '/create') {
        return await create(request, env)
      } else if (path === '') {
        return index(request, env.GITHUB_SHA)
      } else {
        return textResponse('Path not found', 404)
      }
    } catch (error) {
      console.error(error)
      logfire.error('Internal Server Error', { error: (error as any).toString() })
      return textResponse('Internal Server Error', 500)
    }
  },
} satisfies ExportedHandler<Env>

export default instrument(handler, {
  service: {
    name: 'cf-worker',
  },
})

async function get(readToken: string, key: string, request: Request, env: Env): Promise<Response> {
  const { value, metadata } = await env.cloudkvData.getWithMetadata<KVMetadata>(dataKey(readToken, key), 'stream')
  if (!value || !metadata) {
    // only check the namespace if the key does not exist
    const row = await env.DB.prepare('select 1 from namespaces where read_token=?').bind(readToken).first()
    if (row) {
      return textResponse('Key does not exist', 244)
    } else {
      return textResponse('Namespace does not exist', 404)
    }
  }
  return new Response(request.method === 'HEAD' ? '' : value, {
    headers: metadata.content_type ? { 'Content-Type': metadata.content_type } : {},
  })
}

async function set(
  readToken: string,
  key: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const auth = getAuth(request)
  if (!auth) {
    return textResponse('Authorization header not provided', 401)
  }

  let content_type = request.headers.get('Content-Type')
  if (key.length > MAX_KEY_SIZE) {
    return textResponse(`Key length must not exceed ${MAX_KEY_SIZE}`, 414)
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
    return textResponse(`Value size must not exceed ${MAX_VALUE_SIZE_MB}MB`, 413)
  }

  let { writeKey, nsSize } = (await env.DB.prepare(
    `
select
  (select write_token from namespaces where read_token = ?) as writeKey,
  (
    select coalesce(sum(size), 0)
    from kv
    where namespace = ? and key != ? and expiration > datetime('now')
  ) as nsSize;
`,
  )
    .bind(readToken, readToken, key)
    .first<{ writeKey: string | null; nsSize: number }>())!

  if (!writeKey) {
    return textResponse('Namespace does not exist', 404)
  } else if (!compareSecrets(auth, writeKey)) {
    return textResponse('Authorization header does not match write key', 403)
  } else if (nsSize + size > MAX_NAMESPACE_SIZE) {
    return textResponse(`Namespace size limit of ${MAX_NAMESPACE_SIZE_MB}MB would be exceeded`, 413)
  }

  const [row] = await Promise.all([
    env.DB.prepare(
      `
      insert into kv
        (namespace, key, content_type, size, expiration)
      values (?, ?, ?, ?, datetime('now', ?))
      on conflict do update set
        content_type = excluded.content_type,
        size = excluded.size,
        created_at = datetime('now'),
        expiration = excluded.expiration
      returning
      ${sqlIsoDate('created_at')} as created_at,
      ${sqlIsoDate('expiration')} as expiration`,
    )
      .bind(readToken, key, content_type, size, `+${ttl} seconds`)
      .first<{ created_at: string; expiration: string }>(),
    env.cloudkvData.put(dataKey(readToken, key), body, {
      expirationTtl: ttl + 5,
      metadata: { content_type } satisfies KVMetadata,
    }),
  ])
  const { created_at, expiration } = row!
  ctx.waitUntil(
    env.DB.prepare("delete from kv where namespace = ? and expiration < datetime('now')").bind(readToken).run(),
  )

  const url = new URL(request.url)
  url.search = ''
  url.hash = ''
  return jsonResponse({
    url,
    key,
    content_type,
    size,
    created_at,
    expiration,
  })
}

async function del(readToken: string, key: string, request: Request, env: Env): Promise<Response> {
  const auth = getAuth(request)
  if (!auth) {
    return textResponse('Authorization header not provided', 401)
  }

  let row = await env.DB.prepare(`select write_token as writeKey from namespaces where read_token = ?`)
    .bind(readToken)
    .first<{ writeKey: string }>()

  if (!row) {
    return textResponse('Namespace does not exist', 404)
  }
  const { writeKey } = row
  if (!compareSecrets(auth, writeKey)) {
    return textResponse('Authorization header does not match write key', 403)
  }

  await env.cloudkvData.delete(dataKey(readToken, key))
  const deleteRow = await env.DB.prepare('delete from kv where namespace=? and key=? returning size')
    .bind(readToken, key)
    .first()

  if (deleteRow) {
    return textResponse('Key deleted', 200)
  } else {
    return textResponse('Key not found', 244)
  }
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

async function list(readToken: string, request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') {
    return response405('GET')
  }

  const nsExists = await env.DB.prepare('select 1 from namespaces where read_token=?').bind(readToken).first()
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
  url.pathname = `/${readToken}`
  url.search = ''
  url.hash = ''

  const params = like ? [readToken, like, offset] : [readToken, offset]
  const result = await env.DB.prepare(
    `
select
  key,
  content_type,
  size,
  ${sqlIsoDate('created_at')} as created_at,
  ${sqlIsoDate('expiration')} as expiration
from kv
where namespace = ? and expiration > datetime('now') ${like ? `and key like ?` : ''}
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
    logfire.warning('Global NS limit exceeded', { globalCount, ipCount })
    return textResponse(`Global limit (${MAX_GLOBAL_24}) on namespace creation per 24 hours exceeded`, 429)
  } else if (ipCount > MAX_IP_24) {
    logfire.warning('IP NS limit exceeded', { globalCount, ipCount })
    return textResponse(`IP limit (${MAX_IP_24}) on namespace creation per 24 hours exceeded`, 429)
  }

  const url = new URL(request.url)
  url.pathname = ''
  url.search = ''
  url.hash = ''
  const base_url = url.toString().slice(0, -1)

  while (true) {
    // 18 bytes always results in a string of length 24
    const read_token = random(18)
    // 36 bytes always results in a string of length 48
    const write_token = random(36)
    const row = await env.DB.prepare(
      `
insert into namespaces (read_token, write_token, ip) values (?, ?, ?)
on conflict do nothing
returning ${sqlIsoDate('created_at')} as created_at
`,
    )
      .bind(read_token, write_token, ip)
      .first<{ created_at: string }>()
    if (row) {
      const { created_at } = row
      logfire.info('Namespace created', { read_token, created_at, ip })
      return jsonResponse({ base_url, read_token, write_token, created_at })
    }
  }
}

function index(request: Request, githubSha: string): Response {
  const releaseNote = githubSha.startsWith('[')
    ? githubSha
    : `<a href="https://github.com/samuelcolvin/cloudkv/commit/${githubSha}">${githubSha.substring(0, 7)}</a>`
  if (request.method === 'GET') {
    return new Response(
      `\
<h1>cloudkv</h1>
<p>See <a href="https://github.com/samuelcolvin/cloudkv">github.com/samuelcolvin/cloudkv</a> for details.</p>
<p>release: ${releaseNote}</p>
`,
      {
        headers: ctHeader('text/html'),
      },
    )
  } else if (request.method === 'HEAD') {
    return new Response('', { headers: ctHeader('text/html') })
  } else {
    return response405('GET', 'HEAD')
  }
}

function getAuth(request: Request): string | null {
  let auth = request.headers.get('Authorization')
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    auth = auth.slice(7)
  }
  return auth
}

const dataKey = (namespace: string, key: string) => `data:${namespace}:${key}`

const ctHeader = (contentType: string) => ({ 'Content-Type': contentType })

const textResponse = (message: string, status: number) =>
  new Response(`${status}: ${message}`, { status, headers: ctHeader('text/plain') })
const jsonResponse = (data: any) =>
  new Response(JSON.stringify(data, null, 2) + '\n', { headers: ctHeader('application/json') })

function response405(...allowMethods: string[]): Response {
  const allow = allowMethods.join(', ')
  return new Response(`405: Method not allowed, Allowed: ${allow}`, {
    status: 405,
    headers: { allow, ...ctHeader('text/plain') },
  })
}

function getIP(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip')
  if (ip) {
    return ip
  } else {
    throw new Error('IP address not found')
  }
}
const sqlIsoDate = (field: 'created_at' | 'expiration') => `strftime('%Y-%m-%dT%H:%M:%SZ', ${field})`

/// Generate a random string and encode it as URL safe base64
function random(bytes: number): string {
  const uint8Array = new Uint8Array(bytes)
  crypto.getRandomValues(uint8Array)
  // Convert Uint8Array to binary string
  const binaryString = String.fromCharCode.apply(null, Array.from(uint8Array))
  // Encode to base64, and replace `/` with 'a' and `+` with 'b' and `=` with 'c'
  // (this reduces entropy very slightly but makes the secret alpha numeric and easier to use)
  return btoa(binaryString).replaceAll('/', 'a').replaceAll('+', 'b').replaceAll('=', 'c')
}

/// Compare two strings in a constant time manner.
// How much this matters in this case isn't clear, but may as well do it this way.
function compareSecrets(s1: string, s2: string) {
  if (s1.length !== s2.length) {
    return false
  } else {
    let isEqual = true
    for (let i = 0; i < s1.length; i++) {
      if (s1.charCodeAt(i) !== s2.charCodeAt(i)) {
        isEqual = false
      }
    }
    return isEqual
  }
}
