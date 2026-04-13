import https from 'node:https'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── import module under test (mocks are already in place) ───────────────────

import { add, help, list, logger, test as registryTest, remove } from '../main'

// ── mock declarations (hoisted by vitest before any import) ──────────────────

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => 'registry=https://registry.npmjs.org/\n'),
  writeFileSync: vi.fn(),
}))

vi.mock('http', () => ({ default: { get: vi.fn() } }))
vi.mock('https', () => ({ default: { get: vi.fn() } }))

vi.mock('../../custom_registries.json', () => ({ default: {} }))
vi.mock('../../registries.json', () => ({
  default: {
    npm: {
      home: 'https://www.npmjs.org',
      registry: 'https://registry.npmjs.org/',
    },
    taobao: {
      home: 'https://npmmirror.com',
      registry: 'https://registry.npmmirror.com/',
    },
  },
}))

// ── helpers ──────────────────────────────────────────────────────────────────

/** Returns a fake ClientRequest whose .on() is a no-op. */
function fakeReq() {
  return { on: vi.fn().mockReturnThis(), destroy: vi.fn() }
}

/** Configures https.get to call the response callback after one tick. */
function mockHttpsSuccess(statusCode = 200) {
  vi.mocked(https.get).mockImplementation((_u: any, _o: any, cb: any) => {
    setImmediate(() => cb({ statusCode, destroy: vi.fn() }))
    return fakeReq() as any
  })
}

/** Configures https.get to fire the 'timeout' event after one tick. */
function mockHttpsTimeout() {
  vi.mocked(https.get).mockImplementation(() => {
    const handlers: Record<string, () => void> = {}
    const req = {
      on: vi.fn((event: string, cb: () => void) => {
        handlers[event] = cb
        return req
      }),
      destroy: vi.fn(),
    }
    setImmediate(() => handlers.timeout?.())
    return req as any
  })
}

// ── logger ───────────────────────────────────────────────────────────────────

describe('logger', () => {
  it('red() wraps text in red ANSI codes', () => {
    expect(logger.red('err')).toBe('\u001B[31merr\u001B[39m')
  })

  it('green() wraps text in green ANSI codes', () => {
    expect(logger.green('ok')).toBe('\u001B[32mok\u001B[39m')
  })

  it('yellow() wraps text in yellow ANSI codes', () => {
    expect(logger.yellow('warn')).toBe('\u001B[33mwarn\u001B[39m')
  })
})

// ── list() ───────────────────────────────────────────────────────────────────

describe('list()', () => {
  it('includes all registry names and URLs', () => {
    const out = list()
    expect(out).toContain('npm')
    expect(out).toContain('https://registry.npmjs.org/')
    expect(out).toContain('taobao')
    expect(out).toContain('https://registry.npmmirror.com/')
  })

  it('marks the current registry with *', () => {
    const out = list()
    // readFileSync mock returns npm as current
    expect(out).toMatch(/\* npm/)
  })

  it('does not mark non-current registry with *', () => {
    const out = list()
    expect(out).not.toMatch(/\* taobao/)
  })
})

// ── add() ────────────────────────────────────────────────────────────────────

describe('add()', () => {
  afterEach(() => {
    remove('test-reg')
  })

  it('adds a valid registry and returns updated list', () => {
    const out = add('test-reg', 'https://test.registry.io/')
    expect(out).toContain('test-reg')
    expect(out).toContain('https://test.registry.io/')
  })

  it('auto-appends trailing slash when missing', () => {
    add('test-reg', 'https://test.registry.io')
    expect(list()).toContain('https://test.registry.io/')
  })

  it('stores the home field alongside registry', () => {
    const out = add('test-reg', 'https://test.registry.io/', 'https://test.io')
    expect(out).toContain('test-reg')
  })

  it('returns usage hint for non-HTTP URLs', () => {
    const out = add('bad', 'ftp://bad.registry.io/')
    expect(out).toContain('mnrm add <name> <registry>')
  })

  it('returns usage hint when name is missing', () => {
    const out = add('', 'https://test.registry.io/')
    expect(out).toContain('mnrm add <name> <registry>')
  })

  it('rejects a duplicate registry URL', () => {
    add('test-reg', 'https://test.registry.io/')
    const out = add('test-reg-2', 'https://test.registry.io/')
    expect(out).toContain('already exists')
  })

  it('writes custom_registries.json to disk on add', async () => {
    const { writeFileSync } = await import('node:fs')
    add('test-reg', 'https://test.registry.io/')
    expect(vi.mocked(writeFileSync)).toHaveBeenCalled()
  })
})

// ── remove() ─────────────────────────────────────────────────────────────────

describe('remove()', () => {
  beforeEach(() => {
    add('test-reg', 'https://test.registry.io/')
  })

  it('removes an existing custom registry', () => {
    const out = remove('test-reg')
    expect(out).not.toContain('test-reg')
  })

  it('writes custom_registries.json to disk on remove', async () => {
    const { writeFileSync } = await import('node:fs')
    vi.mocked(writeFileSync).mockClear()
    remove('test-reg')
    expect(vi.mocked(writeFileSync)).toHaveBeenCalled()
  })

  it('returns available-for-deletion message for unknown name', () => {
    const out = remove('does-not-exist')
    // test-reg is the only custom registry; unknown name → show available list
    expect(out).toContain('test-reg')
  })

  it('returns yellow message when no custom registries remain', () => {
    remove('test-reg')
    const out = remove('also-gone')
    expect(out).toContain('no more registries')
  })
})

// ── help() ───────────────────────────────────────────────────────────────────

describe('help()', () => {
  it('includes all commands in the help text', () => {
    const out = help()
    for (const cmd of [
      'ls, list',
      'use',
      'add',
      'test',
      'del, delete',
      'rm, remove',
    ]) {
      expect(out).toContain(cmd)
    }
  })

  it('includes example commands', () => {
    const out = help()
    expect(out).toContain('mnrm use npm')
    expect(out).toContain('mnrm list')
    expect(out).toContain('mnrm test')
  })
})

// ── test() / pingRegistry ────────────────────────────────────────────────────

describe('test()', () => {
  afterEach(() => {
    vi.mocked(https.get).mockReset()
  })

  it('calls onResult once per registry (streaming)', async () => {
    mockHttpsSuccess()
    const results: unknown[] = []
    await registryTest(undefined, (r) => results.push(r))
    expect(results).toHaveLength(2) // npm + taobao
  })

  it('each streamed result contains the registry name and timing', async () => {
    mockHttpsSuccess()
    const results: string[] = []
    await registryTest(undefined, (r) => results.push(r as string))
    for (const r of results) {
      expect(r).toMatch(/npm|taobao/)
      expect(r).toMatch(/ms|Timeout/)
    }
  })

  it('marks timed-out registries as "Timeout"', async () => {
    mockHttpsTimeout()
    const results: string[] = []
    await registryTest(undefined, (r) => results.push(r as string))
    expect(results.every((r) => r.includes('Timeout'))).toBe(true)
  })

  it('--info mode: each result is an object with timing fields', async () => {
    mockHttpsSuccess()
    const results: any[] = []
    await registryTest('--info', (r) => results.push(r))
    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r).toHaveProperty('name')
      expect(r).toHaveProperty('code')
      expect(r).toHaveProperty('total')
      expect(r).toHaveProperty('DNS')
      expect(r).toHaveProperty('TCP')
      expect(r).toHaveProperty('start_transfer')
    }
  })

  it('fast responses are colored (contain ANSI codes)', async () => {
    // statusCode 200, near-instant → green
    mockHttpsSuccess(200)
    const results: string[] = []
    await registryTest(undefined, (r) => results.push(r as string))
    // ANSI escape present in at least one result
    expect(results.some((r) => r.includes('\u001B['))).toBe(true)
  })
})
