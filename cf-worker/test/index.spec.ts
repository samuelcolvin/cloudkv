import { env, SELF } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
// @ts-ignore
import SQL from '../schema.sql?raw'

interface CreateNamespace {
  namespace: string
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
  content_type: string
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
`,
    ).run()
    await env.DB.prepare(SQL).run()
  })

  it('responds with index html', async () => {
    const response = await SELF.fetch('https://example.com')
    expect(response.status).toBe(200)
    expect(await response.text()).toMatchInlineSnapshot(
      `"<h1>Cloud KV</h1><p>See <a href="#">samuelcolvin/cloudkv</a> for details.</p>"`,
    )
  })

  it('response 404', async () => {
    const response = await SELF.fetch('https://example.com/404')
    expect(response.status).toBe(404)
    expect(await response.text()).toMatchInlineSnapshot(`"Path not found"`)
  })

  it('creates a KV namespace', async () => {
    const response = await SELF.fetch('https://example.com/create', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '::1' },
    })
    expect(response.status).toBe(200)
    const data = await response.json<CreateNamespace>()
    expect(Object.keys(data)).toEqual(['namespace', 'created_at'])
    expect(data.namespace.length).toMatchInlineSnapshot(`48`)
    expect(data.created_at).toMatch(iso8601Regex)
  })

  it('set a KV, get a value', async () => {
    const createResponse = await SELF.fetch('https://example.com/create/', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '::1' },
    })
    const { namespace } = await createResponse.json<CreateNamespace>()

    const setResponse = await SELF.fetch(`https://example.com/${namespace}/foobar.json`, {
      method: 'POST',
      body: 'testing',
      headers: { 'Content-Type': 'text/plain' },
    })
    expect(setResponse.status).toBe(200)
    const setData = await setResponse.json<SetKV>()
    expect(setData.url).toEqual(`https://example.com/${namespace}/foobar.json`)
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

  it('set a KV, list', async () => {
    const createResponse = await SELF.fetch('https://example.com/create', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '::1' },
    })
    const { namespace } = await createResponse.json<CreateNamespace>()

    const setResponse = await SELF.fetch(`https://example.com/${namespace}/foobar.json`, {
      method: 'POST',
      body: 'testing',
      headers: { 'Content-Type': 'text/plain' },
    })
    expect(setResponse.status).toBe(200)
    const setData = await setResponse.json<SetKV>()

    const listResponse = await SELF.fetch(`https://example.com/${namespace}/`)
    expect(listResponse.status).toBe(200)
    const listData = await listResponse.json<ListResponse>()
    expect(listData.keys.length).toBe(1)
    expect(listData.keys[0].key).toMatchInlineSnapshot(`"foobar.json"`)
    expect(listData.keys[0].content_type).toMatchInlineSnapshot(`"text/plain"`)
    expect(listData.keys[0].size).toMatchInlineSnapshot(`7`)
    expect(listData.keys[0].created_at).toMatch(iso8601Regex)
    expect(listData.keys[0].expiration).toMatch(iso8601Regex)
    expect(listData.keys[0].url).toBe(setData.url)

    const listLikeMatchResponse = await SELF.fetch(`https://example.com/${namespace}/?like=%foo%`)
    expect(listLikeMatchResponse.status).toBe(200)
    const listLikeMatchData = await listLikeMatchResponse.json<ListResponse>()
    expect(listLikeMatchData.keys.length).toBe(1)

    const listLikeNoMatchResponse = await SELF.fetch(`https://example.com/${namespace}/?like=%xxx%`)
    expect(listLikeNoMatchResponse.status).toBe(200)
    const listLikeNoMatchData = await listLikeNoMatchResponse.json<ListResponse>()
    expect(listLikeNoMatchData.keys.length).toBe(0)
  })
})
