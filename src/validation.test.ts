import { describe, expect, it } from 'vitest'
import {
  hasError,
  normalizeDomain,
  normalizePath,
  normalizeTarget,
  parseTarget,
  validateDomain,
  validatePath,
  validateRoot,
  validateSite,
  validateTarget,
} from './validation'
import type { Site } from './types'

const messages = (issues: { message: string }[]) => issues.map((i) => i.message).join(' | ')

describe('normalize', () => {
  it('strips scheme, trailing slash and case from a domain', () => {
    expect(normalizeDomain('  HTTP://MyApp.test/  ')).toBe('myapp.test')
    expect(normalizeDomain('https://app.test')).toBe('app.test')
    expect(normalizeDomain('app.test')).toBe('app.test')
  })

  it('keeps a target path so it can be reported instead of silently dropped', () => {
    expect(normalizeTarget(' https://api.example.com/ ')).toBe('https://api.example.com')
    expect(normalizeTarget('localhost:8080/api')).toBe('localhost:8080/api')
  })

  it('adds the leading slash a Caddy matcher needs', () => {
    expect(normalizePath('api/*')).toBe('/api/*')
    expect(normalizePath(' /api/* ')).toBe('/api/*')
    expect(normalizePath('')).toBe('')
  })
})

describe('parseTarget', () => {
  it('splits scheme, host, port and the leftover path', () => {
    expect(parseTarget('localhost:3000')).toEqual({
      scheme: '',
      host: 'localhost',
      port: '3000',
      rest: '',
    })
    expect(parseTarget('https://api.example.com')).toEqual({
      scheme: 'https',
      host: 'api.example.com',
      port: null,
      rest: '',
    })
    expect(parseTarget('http://a.b.c:8080/some/path')).toEqual({
      scheme: 'http',
      host: 'a.b.c',
      port: '8080',
      rest: '/some/path',
    })
  })

  it('keeps bracketed IPv6 intact', () => {
    expect(parseTarget('[::1]:3000')).toEqual({
      scheme: '',
      host: '[::1]',
      port: '3000',
      rest: '',
    })
  })

  it('does not read a non-numeric suffix as a port', () => {
    expect(parseTarget('redis:primary').port).toBeNull()
    expect(parseTarget('redis:primary').host).toBe('redis:primary')
  })
})

describe('validateDomain', () => {
  it('accepts a plain hostname', () => {
    expect(validateDomain('myapp.test')).toEqual([])
    expect(validateDomain('dev.lfind.io.kr')).toEqual([])
  })

  // Case 1: `http://myapp.test {` in the Caddyfile collides with `tls internal`,
  // and /etc/hosts gets an invalid line that is silently ignored.
  it('rejects a scheme', () => {
    const issues = validateDomain('http://myapp.test')
    expect(hasError(issues)).toBe(true)
    expect(messages(issues)).toContain('스킴')
  })

  // Case 2: /etc/hosts cannot express a port.
  it('rejects a port', () => {
    expect(messages(validateDomain('myapp.test:8443'))).toContain('포트')
  })

  it('rejects a path, whitespace and wildcards', () => {
    expect(hasError(validateDomain('myapp.test/api'))).toBe(true)
    expect(hasError(validateDomain('my app.test'))).toBe(true)
    expect(hasError(validateDomain('*.myapp.test'))).toBe(true)
  })

  it('rejects reserved system names', () => {
    expect(hasError(validateDomain('localhost'))).toBe(true)
  })

  it('rejects invalid characters', () => {
    expect(hasError(validateDomain('my_app.test'))).toBe(true)
    expect(hasError(validateDomain('-app.test'))).toBe(true)
  })

  // Case 9: two sites with the same domain produce duplicate Caddyfile blocks.
  it('rejects a duplicate domain', () => {
    expect(hasError(validateDomain('myapp.test', ['other.test', 'MyApp.test']))).toBe(true)
    expect(validateDomain('myapp.test', ['other.test'])).toEqual([])
  })

  it('warns on a dotless name without blocking', () => {
    const issues = validateDomain('myapp')
    expect(hasError(issues)).toBe(false)
    expect(issues[0].level).toBe('warn')
  })
})

describe('validateTarget', () => {
  it('accepts a local host with a port and no scheme', () => {
    expect(validateTarget('localhost:3000', 'upstream')).toEqual([])
    expect(validateTarget('127.0.0.1:8080', 'upstream')).toEqual([])
  })

  it('requires a port on local hosts', () => {
    expect(hasError(validateTarget('localhost', 'upstream'))).toBe(true)
  })

  // Case 3: Caddy dials plain http, so an https-only origin fails at request time.
  it('requires a scheme on remote hosts', () => {
    const issues = validateTarget('api.example.com', 'upstream')
    expect(hasError(issues)).toBe(true)
    expect(messages(issues)).toContain('http://')
  })

  // Case 4: caddyfile.rs used to silently assume https:// for managed domains.
  it('requires a scheme on a managed-looking domain too', () => {
    expect(hasError(validateTarget('dev.lfind.io.kr', 'rules[0].target'))).toBe(true)
    expect(validateTarget('https://dev.lfind.io.kr', 'rules[0].target')).toEqual([])
  })

  // Case 5: parse_target dropped the path for managed domains but passed it
  // through verbatim for others — a Caddyfile parse error.
  it('rejects a path or query', () => {
    expect(hasError(validateTarget('localhost:8080/api', 'upstream'))).toBe(true)
    expect(hasError(validateTarget('https://api.example.com/v1', 'upstream'))).toBe(true)
    expect(hasError(validateTarget('https://api.example.com?a=1', 'upstream'))).toBe(true)
  })

  it('rejects unsupported schemes', () => {
    expect(hasError(validateTarget('ws://localhost:3000', 'upstream'))).toBe(true)
  })

  it('rejects empty and whitespace values', () => {
    expect(hasError(validateTarget('', 'upstream'))).toBe(true)
    expect(hasError(validateTarget('local host:3000', 'upstream'))).toBe(true)
  })

  it('warns but allows https on localhost', () => {
    const issues = validateTarget('https://localhost:3000', 'upstream')
    expect(hasError(issues)).toBe(false)
    expect(issues[0].level).toBe('warn')
  })
})

describe('validatePath', () => {
  // Case 6: `handle api/*` is a Caddy parse error that fails the whole reload.
  it('requires a leading slash', () => {
    expect(hasError(validatePath('api/*', 'rules[0].path'))).toBe(true)
    expect(validatePath('/api/*', 'rules[0].path')).toEqual([])
  })

  it('rejects empty, whitespace and full URLs', () => {
    expect(hasError(validatePath('', 'rules[0].path'))).toBe(true)
    expect(hasError(validatePath('/api /*', 'rules[0].path'))).toBe(true)
    expect(hasError(validatePath('https://x.test/api', 'rules[0].path'))).toBe(true)
  })
})

describe('validateRoot', () => {
  it('accepts absolute paths and ~/ (expanded on the Rust side)', () => {
    expect(validateRoot('/Users/me/public', 'rules[0].root')).toEqual([])
    expect(validateRoot('~/project/public', 'rules[0].root')).toEqual([])
  })

  it('rejects relative paths', () => {
    expect(hasError(validateRoot('project/public', 'rules[0].root'))).toBe(true)
    expect(hasError(validateRoot('', 'rules[0].root'))).toBe(true)
  })
})

describe('validateSite', () => {
  const site = (overrides: Partial<Site> = {}): Site => ({
    id: 'id',
    domain: 'myapp.test',
    upstream: 'localhost:3000',
    enabled: true,
    rules: [],
    ...overrides,
  })

  it('passes a well-formed site', () => {
    const issues = validateSite(
      site({
        rules: [
          { kind: 'proxy', path: '/api/*', target: 'https://api.example.com' },
          { kind: 'static', path: '/static/*', root: '/Users/me/public' },
          { kind: 'bypass', path: '/admin/*' },
        ],
      })
    )
    expect(issues).toEqual([])
  })

  it('reports issues with their field path', () => {
    const issues = validateSite(
      site({
        domain: 'http://myapp.test',
        rules: [{ kind: 'proxy', path: 'api/*', target: 'api.example.com' }],
      })
    )
    expect(issues.map((i) => i.field)).toEqual(['domain', 'rules[0].path', 'rules[0].target'])
  })

  // Case 8: an empty preset name renders as a blank chip on SiteCard.
  it('validates env presets', () => {
    const issues = validateSite(
      site({
        rules: [
          {
            kind: 'proxy',
            path: '/api/*',
            target: 'localhost:8080',
            envs: [
              { name: '', target: 'localhost:8080' },
              { name: '스테이징', target: 'staging.example.com' },
            ],
          },
        ],
      })
    )
    expect(issues.map((i) => i.field)).toEqual([
      'rules[0].envs[0].name',
      'rules[0].envs[1].target',
    ])
  })

  it('warns when a later rule repeats an earlier path', () => {
    const issues = validateSite(
      site({
        rules: [
          { kind: 'proxy', path: '/api/*', target: 'localhost:8080' },
          { kind: 'bypass', path: '/api/*' },
        ],
      })
    )
    expect(hasError(issues)).toBe(false)
    expect(issues).toHaveLength(1)
    expect(issues[0].field).toBe('rules[1].path')
  })

  it('flags a domain already used by another site', () => {
    const issues = validateSite(site(), [site({ id: 'other' })])
    expect(hasError(issues)).toBe(true)
  })
})
