import { v4 as uuidv4 } from 'uuid'
import mime from 'mime'

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

async function set(namespace: string, key: string, request: Request, env: Env): Promise<Response> {
  if (!request.body) {
    return response400('To set key, the request body must not be empty')
  }
  const nsExists = await env.cloudkv_data.get(namespaceKey(namespace))
  if (!nsExists) {
    return response404('Namespace does not exist')
  }
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

  const createdAtRaw = new Date()
  const createdAt = createdAtRaw.toISOString()
  const expirationRaw = new Date(createdAtRaw.getTime() + ttl * 1000)
  const expiration = expirationRaw.toISOString()
  const metadata: KVMetadata = { contentType, createdAt, ttl, expiration }
  await env.cloudkv_data.put(dataKey(namespace, key), request.body, {
    expiration: expirationRaw.getTime() / 1000,
    metadata,
  })
  return jsonResponse({
    namespace,
    url: request.url,
    key,
    content_type: contentType,
    created_at: createdAt,
    ttl,
    expiration,
  })
}

interface KVMetadata {
  contentType: string | null
  createdAt: string
  expiration: string
  ttl: number
}

async function get(namespace: string, key: string, request: Request, env: Env): Promise<Response> {
  const { value, metadata } = await env.cloudkv_data.getWithMetadata<KVMetadata>(dataKey(namespace, key), 'stream')
  if (!value || !metadata) {
    // only check the namespace if the key does not exist
    const nsExists = await env.cloudkv_data.get(namespaceKey(namespace))
    if (nsExists) {
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

interface ListKey {
  key: string
  url: string
  metadata?: KVMetadata
}

interface ListResponse {
  namespace: string
  createdAt: string
  keys: ListKey[]
}

async function list(namespace: string, prefix: string, request: Request, env: Env): Promise<Response> {
  const createdAt = await env.cloudkv_data.get(namespaceKey(namespace))
  if (!createdAt) {
    return response404('Namespace does not exist')
  }
  const list = await env.cloudkv_data.list<KVMetadata>({ prefix: dataKey(namespace, prefix) })
  console.log(list)
  const url = new URL(request.url)
  url.pathname = `/${namespace}`
  const response: ListResponse = {
    namespace,
    createdAt,
    keys: list.keys.map(({ name, metadata }) => {
      const key = name.split(':')[2]
      return {
        key,
        url: `${url}/${key}`,
        metadata: metadata,
      }
    }),
  }
  return jsonResponse(response)
}

async function create(request: Request, env: Env): Promise<Response> {
  if (request.method === 'POST') {
    return response405('POST')
  }
  // TODO rate limit
  let namespace = uuidv4()
  while (await env.cloudkv_data.get(namespaceKey(namespace))) {
    namespace = uuidv4()
  }
  const createdAt = new Date().toISOString()
  await env.cloudkv_data.put(namespaceKey(namespace), createdAt)
  return jsonResponse({ namespace, created_at: createdAt })
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

const namespaceKey = (namespace: string) => `namespace:${namespace}`
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
const jsonResponse = (data: any) =>
  new Response(JSON.stringify(data, null, 2) + '\n', { headers: ctHeader('application/json') })
