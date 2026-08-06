/**
 * Input validation for site / rule fields.
 *
 * Each field has its own syntax, and the differences are invisible in the UI —
 * `domain` must NOT carry a scheme (it becomes a Caddyfile site address and an
 * /etc/hosts entry), while a remote `target` MUST carry one (Caddy dials plain
 * http otherwise). Everything here exists so those mistakes surface at save
 * time instead of at Caddy reload / request time.
 *
 * The same rules are mirrored in `src-tauri/src/validate.rs`, which guards the
 * paths that bypass this UI (hand-edited config.json, older saved data).
 */

import type { Rule, Site } from './types'

export type IssueLevel = 'error' | 'warn'

/**
 * `field` is a path into the site: `domain`, `upstream`, `rules[0].target`,
 * `rules[0].envs[1].name`. Callers filter by prefix to place messages.
 */
export type Issue = { field: string; level: IssueLevel; message: string }

/** Hosts that resolve to this machine — scheme may be omitted for these. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']

/** Reserved names we refuse as a site domain — claiming them breaks the system. */
const RESERVED_DOMAINS = ['localhost', 'local', 'broadcasthost']

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i
const DOMAIN_LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

const error = (field: string, message: string): Issue => ({ field, level: 'error', message })
const warn = (field: string, message: string): Issue => ({ field, level: 'warn', message })

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Strip the scheme / trailing slash users paste in, and lowercase. */
export function normalizeDomain(value: string): string {
  return value.trim().replace(SCHEME_RE, '').replace(/\/+$/, '').toLowerCase()
}

/** Trim and drop a trailing slash. Paths are NOT stripped — those are an error. */
export function normalizeTarget(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

/** Trim and ensure the leading slash Caddy's `handle` matcher requires. */
export function normalizePath(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.startsWith('/')) return trimmed
  return `/${trimmed}`
}

export function normalizeRoot(value: string): string {
  return value.trim()
}

// ---------------------------------------------------------------------------
// Target parsing
// ---------------------------------------------------------------------------

export type ParsedTarget = {
  scheme: string
  host: string
  port: string | null
  /** Everything after the host:port — must be empty for a Caddy upstream. */
  rest: string
}

export function parseTarget(value: string): ParsedTarget {
  const schemeMatch = value.match(SCHEME_RE)
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : ''
  const afterScheme = schemeMatch ? value.slice(schemeMatch[0].length) : value

  const restIndex = afterScheme.search(/[/?#]/)
  const authority = restIndex === -1 ? afterScheme : afterScheme.slice(0, restIndex)
  const rest = restIndex === -1 ? '' : afterScheme.slice(restIndex)

  // Bracketed IPv6 (`[::1]:3000`) keeps its brackets as part of the host.
  const bracketMatch = authority.match(/^(\[[^\]]*\])(?::(\d+))?$/)
  if (bracketMatch) {
    return { scheme, host: bracketMatch[1], port: bracketMatch[2] ?? null, rest }
  }

  const colonIndex = authority.lastIndexOf(':')
  if (colonIndex > 0) {
    const maybePort = authority.slice(colonIndex + 1)
    if (/^\d+$/.test(maybePort)) {
      return { scheme, host: authority.slice(0, colonIndex), port: maybePort, rest }
    }
  }
  return { scheme, host: authority, port: null, rest }
}

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.includes(host.toLowerCase())
}

// ---------------------------------------------------------------------------
// Field validators
// ---------------------------------------------------------------------------

export function validateDomain(value: string, otherDomains: string[] = [], field = 'domain'): Issue[] {
  const raw = value.trim()
  if (raw === '') return [error(field, '도메인을 입력하세요.')]
  if (/\s/.test(raw)) return [error(field, '도메인에 공백을 넣을 수 없습니다.')]

  if (SCHEME_RE.test(raw)) {
    return [error(field, 'http:// 같은 스킴은 빼고 도메인만 입력하세요. (예: myapp.test)')]
  }
  if (raw.includes('/')) {
    return [error(field, '도메인에 경로를 넣을 수 없습니다. 경로는 아래 경로 규칙에서 지정하세요.')]
  }
  if (raw.includes(':')) {
    return [error(field, '도메인에 포트를 넣을 수 없습니다. 포트는 Upstream 에 지정하세요.')]
  }
  if (raw.includes('*')) {
    return [error(field, '와일드카드 도메인은 /etc/hosts 에 등록할 수 없습니다.')]
  }

  const lower = raw.toLowerCase()
  if (RESERVED_DOMAINS.includes(lower)) {
    return [error(field, `'${lower}' 는 시스템 예약 이름이라 사용할 수 없습니다.`)]
  }

  const labels = lower.split('.')
  if (!labels.every((label) => DOMAIN_LABEL_RE.test(label))) {
    return [error(field, '도메인은 영문 소문자·숫자·하이픈만 쓸 수 있습니다. (예: myapp.test)')]
  }

  const issues: Issue[] = []
  if (otherDomains.some((d) => d.trim().toLowerCase() === lower)) {
    issues.push(error(field, '이미 등록된 도메인입니다.'))
  }
  if (labels.length === 1) {
    issues.push(warn(field, '점이 없는 이름은 검색 도메인과 충돌할 수 있습니다. (예: myapp.test)'))
  }
  return issues
}

/**
 * Validate a reverse-proxy upstream.
 *
 * Scheme policy: local hosts may omit it (Caddy defaults to http, which is what
 * a dev server speaks) but must carry a port; remote hosts must state it, since
 * defaulting to http against an https-only origin fails at request time.
 */
export function validateTarget(value: string, field: string, label = '주소'): Issue[] {
  const raw = value.trim()
  if (raw === '') return [error(field, `${label}를 입력하세요.`)]
  if (/\s/.test(raw)) return [error(field, `${label}에 공백을 넣을 수 없습니다.`)]

  const parsed = parseTarget(raw)

  if (parsed.scheme !== '' && parsed.scheme !== 'http' && parsed.scheme !== 'https') {
    return [error(field, `지원하지 않는 스킴입니다: ${parsed.scheme}://`)]
  }
  if (parsed.rest !== '') {
    return [error(field, `${label}에는 경로·쿼리를 넣을 수 없습니다. 호스트와 포트만 입력하세요.`)]
  }
  if (parsed.host === '') {
    return [error(field, `${label} 형식이 올바르지 않습니다. (예: localhost:3000)`)]
  }

  const local = isLocalHost(parsed.host)
  if (!local && !/^[a-z0-9.\-[\]:]+$/i.test(parsed.host)) {
    return [error(field, `${label} 형식이 올바르지 않습니다. (예: https://api.example.com)`)]
  }

  const issues: Issue[] = []
  if (local) {
    if (parsed.port === null) {
      issues.push(error(field, '로컬 주소에는 포트가 필요합니다. (예: localhost:3000)'))
    }
    if (parsed.scheme === 'https') {
      issues.push(warn(field, '로컬 서버가 HTTPS 가 아니라면 https:// 를 빼세요.'))
    }
  } else if (parsed.scheme === '') {
    issues.push(
      error(field, '원격 주소에는 http:// 또는 https:// 를 붙여주세요. (예: https://api.example.com)')
    )
  }
  return issues
}

export function validatePath(value: string, field: string): Issue[] {
  const raw = value.trim()
  if (raw === '') return [error(field, '경로를 입력하세요. (예: /api/*)')]
  if (/\s/.test(raw)) return [error(field, '경로에 공백을 넣을 수 없습니다.')]
  if (SCHEME_RE.test(raw)) return [error(field, '경로에는 도메인이 아니라 경로만 입력하세요. (예: /api/*)')]
  if (!raw.startsWith('/')) return [error(field, "경로는 '/' 로 시작해야 합니다. (예: /api/*)")]
  return []
}

/**
 * Static file root. `~/` is accepted here and expanded by the Rust side when
 * the Caddyfile is generated — Caddy itself does not expand it.
 */
export function validateRoot(value: string, field: string): Issue[] {
  const raw = value.trim()
  if (raw === '') return [error(field, '정적 파일 경로를 입력하세요.')]
  if (!raw.startsWith('/') && !raw.startsWith('~/')) {
    return [error(field, "절대 경로를 입력하세요. (예: /Users/me/project/public)")]
  }
  return []
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export function validateRule(rule: Rule, prefix: string): Issue[] {
  const issues = validatePath(rule.path, `${prefix}.path`)

  if (rule.kind === 'proxy') {
    issues.push(...validateTarget(rule.target, `${prefix}.target`, '프록시 타겟'))
    ;(rule.envs ?? []).forEach((env, i) => {
      const envPrefix = `${prefix}.envs[${i}]`
      if (env.name.trim() === '') {
        issues.push(error(`${envPrefix}.name`, '프리셋 이름을 입력하세요.'))
      }
      issues.push(...validateTarget(env.target, `${envPrefix}.target`, '프리셋 타겟'))
    })
  } else if (rule.kind === 'static') {
    issues.push(...validateRoot(rule.root, `${prefix}.root`))
  }

  return issues
}

/** `otherSites` is every site except the one being edited (for duplicate checks). */
export function validateSite(site: Site, otherSites: Site[] = []): Issue[] {
  const issues = [
    ...validateDomain(site.domain, otherSites.map((s) => s.domain)),
    ...validateTarget(site.upstream, 'upstream', 'Upstream'),
  ]

  const seenPaths = new Set<string>()
  site.rules.forEach((rule, i) => {
    const prefix = `rules[${i}]`
    issues.push(...validateRule(rule, prefix))

    const path = rule.path.trim()
    if (path !== '') {
      if (seenPaths.has(path)) {
        issues.push(warn(`${prefix}.path`, '앞의 규칙과 경로가 같아 이 규칙은 적용되지 않습니다.'))
      }
      seenPaths.add(path)
    }
  })

  return issues
}

export const hasError = (issues: Issue[]): boolean => issues.some((i) => i.level === 'error')

/** Issues for exactly `field`. */
export const issuesFor = (issues: Issue[], field: string): Issue[] =>
  issues.filter((i) => i.field === field)

/** Re-root `rules[i].*` issues to `*` so RuleEditor can look them up locally. */
export const issuesUnder = (issues: Issue[], prefix: string): Issue[] =>
  issues
    .filter((i) => i.field.startsWith(`${prefix}.`))
    .map((i) => ({ ...i, field: i.field.slice(prefix.length + 1) }))
