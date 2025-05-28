import { v4 as uuidv4 } from 'uuid'
import mime from 'mime'

// maximum number of namespaces that can be created in 24 hours, across all IPs
const MAX_GLOBAL_24 = 1000
// maximum number of namespaces that can be created in 24 hours, per IP
const MAX_IP_24 = 20
// maximum size of a namespace in bytes
const MAX_NAMESPACE_SIZE = 1024 * 1024 * 100
// maximum size of a value in bytes, this is a limitation of cloudflare KV
const MAX_VALUE_SIZE = 1024 * 1024 * 25

export default {
  async fetch(request, env): Promise<Response> {
    let path = new URL(request.url).pathname
    if (path.endsWith('/')) {
      path = path.slice(0, -1)
    }
    const match = path.match(/^\/([a-f0-9-]{36})\/?(.*)$/)
    if (match) {
      const [_, namespace, key] = match
      if (request.method === 'GET' || request.method === 'HEAD') {
        return await get(namespace, key, request, env)
      } else if (request.method === 'POST') {
        return await set(namespace, key, request, env)
      } else if (request.method === 'OPTIONS') {
        return await list(namespace, key, request, env)
      } else {
        return response405('GET', 'HEAD', 'POST', 'OPTIONS')
      }
    } else if (path === '/create') {
      return await create(request, env)
    } else if (path === '') {
      return index(request)
    } else {
      return response404('Not found')
    }
  },
} satisfies ExportedHandler<Env>

async function get(namespace: string, key: string, request: Request, env: Env): Promise<Response> {
  const { value, metadata } = await env.cloudkvData.getWithMetadata<KVMetadata>(dataKey(namespace, key), 'stream')
  if (!value || !metadata) {
    // only check the namespace if the key does not exist
    const row = await env.DB.prepare('select 1 from namespaces where id=?').bind(namespace).first()
    if (row) {
      return response404('Key does not exist')
    } else {
      return response404('Namespace does not exist')
    }
  }
  const { contentType, createdAt, ttl, expiration } = metadata
  return new Response(request.method === 'HEAD' ? '' : value, {
    headers: {
      'Content-Type': contentType || 'application/octet-stream',
      'X-CloudKV-Created-At': createdAt,
      'X-CloudKV-TTL': ttl.toString(),
      'X-CloudKV-Expiration': expiration,
    },
  })
}

async function set(namespace: string, key: string, request: Request, env: Env): Promise<Response> {
  let contentType = request.headers.get('Content-Type')
  if (!contentType) {
    contentType = mime.getType(key)
  }

  const ttl_header = request.headers.get('x-cloudkv-ttl')
  let ttl: number
  try {
    ttl = parseFloat(ttl_header || '31536000')
  } catch (error) {
    return response400(`Invalid "X-CloudKV-TTL" header "${ttl_header}": not a valid number`)
  }
  if (ttl < 60 || ttl > 31536000) {
    return response400(`Invalid "X-CloudKV-TTL" header "${ttl_header}": must be >60 and <=31536000 seconds`)
  }

  const body = await request.arrayBuffer()
  const size = body.byteLength
  if (!size) {
    return response400('To set a key, the request body must not be empty')
  }
  if (size > MAX_VALUE_SIZE) {
    return response400('To set a key, the key size must not exceed 25MB')
  }

  const row: { size: number } | null = await env.DB.prepare('select size from namespaces where id=?')
    .bind(namespace)
    .first()
  if (!row) {
    return response404('Namespace not found')
  } else if (row.size + size > MAX_NAMESPACE_SIZE) {
    return response400('Namespace size limit of 100MB would be exceeded')
  }

  const createdAtRaw = new Date()
  const createdAt = createdAtRaw.toISOString()
  const expirationRaw = new Date(createdAtRaw.getTime() + ttl * 1000)
  const expiration = expirationRaw.toISOString()
  const metadata: KVMetadata = { contentType, size, createdAt, ttl, expiration }
  await env.cloudkvData.put(dataKey(namespace, key), body, {
    expiration: expirationRaw.getTime() / 1000,
    metadata,
  })
  await env.DB.prepare('update namespaces set size=size+? where id=?').bind(size, namespace).run()
  return jsonResponse({
    url: request.url,
    metadata,
  })
}

interface KVMetadata {
  contentType: string | null
  size: number
  createdAt: string
  expiration: string
  ttl: number
}

interface ListKey {
  url: string
  metadata?: KVMetadata
}

interface ListResponse {
  namespace: string
  namespace_created_at: string
  namespace_size: number
  keys_size: number
  keys: ListKey[]
}

async function list(namespace: string, prefix: string, request: Request, env: Env): Promise<Response> {
  const row: { namespace_created_at: string; namespace_size: number } | null = await env.DB.prepare(
    `
select
  strftime('%Y-%m-%dT%H:%M:%fZ', ts) as namespace_created_at,
  size as namespace_size
from namespaces where id=?`,
  )
    .bind(namespace)
    .first()
  if (!row) {
    return response404('Namespace does not exist')
  }
  const { namespace_created_at, namespace_size } = row
  const list = await env.cloudkvData.list<KVMetadata>({ prefix: dataKey(namespace, prefix) })
  console.log(list)
  const url = new URL(request.url)
  url.pathname = `/${namespace}`
  const keys_size = list.keys.reduce((acc, { metadata }) => acc + (metadata ? metadata.size : 0), 0)
  const response: ListResponse = {
    namespace,
    namespace_created_at,
    namespace_size,
    keys_size,
    keys: list.keys.map(({ name, metadata }) => ({ url: `${url}/${name.split(':')[2]}`, metadata })),
  }
  return jsonResponse(response)
}

async function create(request: Request, env: Env): Promise<Response> {
  if (request.method === 'POST') {
    return response405('POST')
  }
  const ip = getIP(request)
  let { global_count, ip_count } = (await env.DB.prepare(
    `
with global_count as (
  select count(*) as count from namespaces where ts > DATETIME('now', '-24 hours')
),
ip_count as (
  select count(*) as count from namespaces where ts > DATETIME('now', '-24 hours') and ip = ?
)
select global_count.count as global_count, ip_count.count as ip_count
from global_count, ip_count
`,
  )
    .bind(ip)
    .first()) as { global_count: number; ip_count: number }

  console.log('namespace creation', { global_count, ip_count, ip })
  if (global_count > MAX_GLOBAL_24) {
    return response429(`Global limit (${MAX_GLOBAL_24}) on namespace creation per 24 hours exceeded`)
  } else if (ip_count > MAX_IP_24) {
    return response429(`IP limit (${MAX_IP_24}) on namespace creation per 24 hours exceeded`)
  }

  let namespace = uuidv4()
  let { created_at } = (await env.DB.prepare(
    `insert into namespaces (id, ip) values (?, ?) returning strftime('%Y-%m-%dT%H:%M:%fZ', ts) as created_at`,
  )
    .bind(namespace, ip)
    .first()) as { created_at: string }
  return jsonResponse({ namespace, created_at })
}

function index(request: Request): Response {
  if (request.method === 'GET') {
    return new Response('<h1>Cloud KV</h1><p>See <a href="#">pydantic/cloudkv</a> for details.</p>', {
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
const response405 = (...allowMethods: string[]) => {
  const allow = allowMethods.join(', ')
  return new Response(`Method not allowed, Allowed: ${allow}`, {
    status: 405,
    headers: { allow, ...ctHeader('text/plain') },
  })
}
const response404 = (message: string) => new Response(message, { status: 404, headers: ctHeader('text/plain') })
const response400 = (message: string) => new Response(message, { status: 400, headers: ctHeader('text/plain') })
const response429 = (message: string) => new Response(message, { status: 429, headers: ctHeader('text/plain') })
const jsonResponse = (data: any) =>
  new Response(JSON.stringify(data, null, 2) + '\n', { headers: ctHeader('application/json') })

const getIP = (request: Request): string => {
  const ip = request.headers.get('cf-connecting-ip')
  if (ip) {
    return ip
  } else {
    throw new Error('IP address not found')
  }
}
