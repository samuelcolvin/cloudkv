import { env, SELF } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
// @ts-ignore
import SQL from '../schema.sql?raw'

interface CreateNamespace {
  read_key: string
  write_key: string
  created_at: string
}

interface SetKV {
  url: string
  key: string
  content_type: string
  size: number
  created_at: string
  expiration: string
}

interface ListKey {
  url: string
  key: string
  content_type: string | null
  size: number
  created_at: string
  expiration: string
}

interface ListResponse {
  keys: ListKey[]
}

const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

describe('cf-worker', () => {
  beforeAll(async () => {
    await env.DB.prepare(
      `
DROP TABLE IF EXISTS namespaces;
DROP TABLE IF EXISTS kv;

${SQL}
`,
    ).run()
  })

  it('responds with index html', async () => {
    const response = await SELF.fetch('https://example.com')
    expect(response.status).toBe(200)
    expect(await response.text()).toMatchInlineSnapshot(
      `
      "<h1>Cloud KV</h1>
      <p>See <a href="https://github.com/samuelcolvin/cloudkv">github.com/samuelcolvin/cloudkv</a> for details.</p>
      "
    `,
    )
  })

  it('response 404', async () => {
    const response = await SELF.fetch('https://example.com/404')
    expect(response.status).toBe(404)
    expect(await response.text()).toMatchInlineSnapshot(`"404: Path not found"`)
  })

  it('creates a KV namespace', async () => {
    const response = await SELF.fetch('https://example.com/create', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '::1' },
    })
    expect(response.status).toBe(200)
    const data = await response.json<CreateNamespace>()
    expect(Object.keys(data)).toEqual(['read_key', 'write_key', 'created_at'])
    expect(data.read_key.length).toBe(24)
    expect(data.write_key.length).toBe(48)
    expect(data.created_at).toMatch(iso8601Regex)

    const response2 = await SELF.fetch('https://example.com/create', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '::1' },
    })
    expect(response2.status).toBe(200)
    const data2 = await response2.json<CreateNamespace>()
    expect(data2.read_key).not.toBe(data.read_key)
    expect(data2.write_key).not.toBe(data.write_key)
  })

  it('set a KV, no content type', async () => {
    const createResponse = await SELF.fetch('https://example.com/create/', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '::1' },
    })
    const { read_key, write_key } = await createResponse.json<CreateNamespace>()

    const setResponse = await SELF.fetch(`https://example.com/${read_key}/foobar.json`, {
      method: 'POST',
      body: 'testing',
      headers: { 'content-type': '', Authorization: write_key },
    })
    expect(setResponse.status).toBe(200)
    const setData = await setResponse.json<SetKV>()
    expect(setData.url).toEqual(`https://example.com/${read_key}/foobar.json`)
    expect(setData.key).toMatchInlineSnapshot(`"foobar.json"`)
    expect(setData.content_type).toBeNull()
    expect(setData.size).toMatchInlineSnapshot(`7`)
    expect(setData.created_at).toMatch(iso8601Regex)
    expect(setData.expiration).toMatch(iso8601Regex)

    const getResponse = await SELF.fetch(setData.url)
    expect(getResponse.status).toBe(200)
    const text = await getResponse.text()
    expect(text).toMatchInlineSnapshot(`"testing"`)
    const contentType = getResponse.headers.get('content-type')
    expect(contentType).toBeNull()
  })

  it('set a KV, get a value', async () => {
    const createResponse = await SELF.fetch('https://example.com/create/', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '::1' },
    })
    const { read_key, write_key } = await createResponse.json<CreateNamespace>()

    const setResponse = await SELF.fetch(`https://example.com/${read_key}/foobar.json`, {
      method: 'POST',
      body: 'testing',
      headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${write_key}` },
    })
    expect(setResponse.status).toBe(200)
    const setData = await setResponse.json<SetKV>()
    expect(setData.url).toEqual(`https://example.com/${read_key}/foobar.json`)
    expect(setData.key).toMatchInlineSnapshot(`"foobar.json"`)
    expect(setData.content_type).toMatchInlineSnapshot(`"text/plain"`)
    expect(setData.size).toMatchInlineSnapshot(`7`)
    expect(setData.created_at).toMatch(iso8601Regex)
    expect(setData.expiration).toMatch(iso8601Regex)

    const getResponse = await SELF.fetch(setData.url)
    expect(getResponse.status).toBe(200)
    const text = await getResponse.text()
    expect(text).toMatchInlineSnapshot(`"testing"`)
    const contentType = getResponse.headers.get('content-type')
    expect(contentType).toMatchInlineSnapshot(`"text/plain"`)
  })

  it('get no namespace', async () => {
    const response = await SELF.fetch(`https://example.com/${'1'.repeat(24)}/foobar.json`)
    expect(response.status).toBe(404)
    expect(await response.text()).toEqual('404: Namespace does not exist')
  })

  it('get no key', async () => {
    const createResponse = await SELF.fetch('https://example.com/create/', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '::1' },
    })
    const { read_key } = await createResponse.json<CreateNamespace>()

    const response = await SELF.fetch(`https://example.com/${read_key}/foobar.json`)
    expect(response.status).toBe(244)
    expect(await response.text()).toEqual('244: Key does not exist')
  })

  it('set a KV, list', async () => {
    const createResponse = await SELF.fetch('https://example.com/create', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '::1' },
    })
    const { read_key, write_key } = await createResponse.json<CreateNamespace>()

    const setResponse = await SELF.fetch(`https://example.com/${read_key}/foobar.json`, {
      method: 'POST',
      body: 'testing',
      headers: { 'Content-Type': 'text/plain', Authorization: write_key },
    })
    expect(setResponse.status).toBe(200)
    const setData = await setResponse.json<SetKV>()

    const listResponse = await SELF.fetch(`https://example.com/${read_key}/`)
    expect(listResponse.status).toBe(200)
    const listData = await listResponse.json<ListResponse>()
    expect(listData.keys.length).toBe(1)
    expect(listData.keys[0].key).toMatchInlineSnapshot(`"foobar.json"`)
    expect(listData.keys[0].content_type).toMatchInlineSnapshot(`"text/plain"`)
    expect(listData.keys[0].size).toMatchInlineSnapshot(`7`)
    expect(listData.keys[0].created_at).toMatch(iso8601Regex)
    expect(listData.keys[0].expiration).toMatch(iso8601Regex)
    expect(listData.keys[0].url).toBe(setData.url)

    const listLikeMatchResponse = await SELF.fetch(`https://example.com/${read_key}/?like=%foo%`)
    expect(listLikeMatchResponse.status).toBe(200)
    const listLikeMatchData = await listLikeMatchResponse.json<ListResponse>()
    expect(listLikeMatchData.keys.length).toBe(1)

    const listLikeNoMatchResponse = await SELF.fetch(`https://example.com/${read_key}/?like=%xxx%`)
    expect(listLikeNoMatchResponse.status).toBe(200)
    const listLikeNoMatchData = await listLikeNoMatchResponse.json<ListResponse>()
    expect(listLikeNoMatchData.keys.length).toBe(0)
  })

  it('returns 404 for invalid read key', async () => {
    const response = await SELF.fetch(`https://example.com/${'1'.repeat(20)}/foobar.json`, {
      method: 'POST',
      body: 'testing',
      headers: { 'Content-Type': 'text/plain', authorization: 'xxx' },
    })
    expect(response.status).toBe(404)
    expect(await response.text()).toEqual('404: Path not found')
  })

  it('returns 404 for unknown read key', async () => {
    const wrongReadKeyResponse = await SELF.fetch(`https://example.com/${'1'.repeat(24)}/foobar.json`, {
      method: 'POST',
      body: 'testing',
      headers: { 'Content-Type': 'text/plain', authorization: 'xxx' },
    })
    expect(wrongReadKeyResponse.status).toBe(404)
    expect(await wrongReadKeyResponse.text()).toEqual('404: Namespace does not exist')
  })

  it('returns 401 or 403 for bad write key', async () => {
    const createResponse = await SELF.fetch('https://example.com/create', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '::1' },
    })
    const { read_key, write_key } = await createResponse.json<CreateNamespace>()

    const noAuthResponse = await SELF.fetch(`https://example.com/${read_key}/foobar.json`, {
      method: 'POST',
      body: 'testing',
      headers: { 'Content-Type': 'text/plain' },
    })
    expect(noAuthResponse.status).toBe(401)
    expect(await noAuthResponse.text()).toEqual('401: Authorization header not provided')

    const wrongAuthResponse1 = await SELF.fetch(`https://example.com/${read_key}/foobar.json`, {
      method: 'POST',
      body: 'testing',
      headers: { 'Content-Type': 'text/plain', authorization: 'xxx' },
    })
    expect(wrongAuthResponse1.status).toBe(403)
    expect(await wrongAuthResponse1.text()).toEqual('403: Authorization header does not match write key')

    // write key length, but wrong case
    const wrongAuthResponse2 = await SELF.fetch(`https://example.com/${read_key}/foobar.json`, {
      method: 'POST',
      body: 'testing',
      headers: { 'Content-Type': 'text/plain', authorization: write_key.toLowerCase() },
    })
    expect(wrongAuthResponse2.status).toBe(403)
    expect(await wrongAuthResponse2.text()).toEqual('403: Authorization header does not match write key')
  })

  it('set, gets, delete, get, delete', async () => {
    const createResponse = await SELF.fetch('https://example.com/create/', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '::1' },
    })
    const { read_key, write_key } = await createResponse.json<CreateNamespace>()

    const setResponse = await SELF.fetch(`https://example.com/${read_key}/foobar.json`, {
      method: 'POST',
      body: 'testing',
      headers: { Authorization: write_key },
    })
    expect(setResponse.status).toBe(200)
    const setData = await setResponse.json<SetKV>()

    const getResponse = await SELF.fetch(setData.url)
    expect(getResponse.status).toBe(200)
    expect(await getResponse.text()).toEqual('testing')

    const deleteResponse = await SELF.fetch(`https://example.com/${read_key}/foobar.json`, {
      method: 'DELETE',
      headers: { Authorization: write_key },
    })
    expect(deleteResponse.status).toBe(200)
    expect(await deleteResponse.text()).toEqual('200: Key deleted')

    const getResponse2 = await SELF.fetch(setData.url)
    expect(getResponse2.status).toBe(244)
    expect(await getResponse2.text()).toEqual('244: Key does not exist')

    const deleteResponse2 = await SELF.fetch(`https://example.com/${read_key}/foobar.json`, {
      method: 'DELETE',
      headers: { Authorization: write_key },
    })
    expect(deleteResponse2.status).toBe(244)
    expect(await deleteResponse2.text()).toEqual('244: Key not found')
  })

  it('delete no auth', async () => {
    const deleteResponse = await SELF.fetch(`https://example.com/${'1'.repeat(24)}/foobar.json`, {
      method: 'DELETE',
    })
    expect(deleteResponse.status).toBe(401)
    expect(await deleteResponse.text()).toEqual('401: Authorization header not provided')
  })

  it('delete wrong auth', async () => {
    const createResponse = await SELF.fetch('https://example.com/create/', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '::1' },
    })
    const { read_key, write_key } = await createResponse.json<CreateNamespace>()

    const setResponse = await SELF.fetch(`https://example.com/${read_key}/foobar.json`, {
      method: 'POST',
      body: 'testing',
      headers: { Authorization: write_key },
    })
    expect(setResponse.status).toBe(200)
    const setData = await setResponse.json<SetKV>()

    const deleteResponse = await SELF.fetch(`https://example.com/${read_key}/foobar.json`, {
      method: 'DELETE',
      headers: { Authorization: write_key.toLowerCase() },
    })
    expect(deleteResponse.status).toBe(403)
    expect(await deleteResponse.text()).toEqual('403: Authorization header does not match write key')

    const getResponse = await SELF.fetch(setData.url)
    expect(getResponse.status).toBe(200)
    expect(await getResponse.text()).toEqual('testing')
  })

  it('delete no namespace', async () => {
    const deleteResponse = await SELF.fetch(`https://example.com/${'1'.repeat(24)}/foobar.json`, {
      method: 'DELETE',
      headers: { Authorization: '1'.repeat(48) },
    })
    expect(deleteResponse.status).toBe(404)
    expect(await deleteResponse.text()).toEqual('404: Namespace does not exist')
  })
})
