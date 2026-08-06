import { useState } from 'react'
import type { Rule, Site } from '../types'
import {
  hasError,
  issuesFor,
  issuesUnder,
  normalizeDomain,
  normalizeTarget,
  validateSite,
} from '../validation'
import { FieldIssues } from './FieldIssues'
import { RuleEditor } from './RuleEditor'

type Props = {
  site: Site
  /** Every other site — used to reject a domain that is already registered. */
  otherSites: Site[]
  onSave: (site: Site) => void
  onCancel: () => void
}

export function SiteDialog({ site, otherSites, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<Site>(site)
  const [domainCleaned, setDomainCleaned] = useState(false)

  const issues = validateSite(draft, otherSites)
  const isValid = !hasError(issues)

  const handleDomainChange = (raw: string) => {
    const normalized = normalizeDomain(raw)
    // Pasting a full URL is common; strip the scheme / trailing slash rather
    // than blocking, but say so — a silent edit reads as a bug.
    setDomainCleaned(normalized !== raw.trim().toLowerCase())
    setDraft({ ...draft, domain: normalized })
  }

  const addRule = () => {
    const newRule: Rule = { kind: 'proxy', path: '/api/*', target: 'localhost:8080' }
    setDraft({ ...draft, rules: [...draft.rules, newRule] })
  }

  const updateRule = (index: number, rule: Rule) => {
    const rules = draft.rules.map((r, i) => (i === index ? rule : r))
    setDraft({ ...draft, rules })
  }

  const removeRule = (index: number) => {
    setDraft({ ...draft, rules: draft.rules.filter((_, i) => i !== index) })
  }

  const fieldClass = (field: string) =>
    issuesFor(issues, field).some((i) => i.level === 'error') ? 'invalid' : undefined

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>{site.domain ? `${site.domain} 편집` : '새 사이트'}</h2>
        </div>

        <div className="dialog-body">
          <label className="field">
            <span className="field-label">도메인</span>
            <input
              type="text"
              value={draft.domain}
              placeholder="myapp.test"
              onChange={(e) => handleDomainChange(e.target.value)}
              className={fieldClass('domain')}
              autoFocus
            />
            <span className="field-hint">
              스킴·포트 없이 호스트만 입력하세요. /etc/hosts 에 자동 등록됩니다.
            </span>
            {domainCleaned && (
              <span className="field-warn">붙여넣은 주소에서 스킴·끝 슬래시를 제거했습니다.</span>
            )}
            <FieldIssues issues={issuesFor(issues, 'domain')} />
          </label>

          <label className="field">
            <span className="field-label">기본 Upstream</span>
            <input
              type="text"
              value={draft.upstream}
              placeholder="localhost:3000"
              onChange={(e) => setDraft({ ...draft, upstream: e.target.value })}
              onBlur={(e) => setDraft({ ...draft, upstream: normalizeTarget(e.target.value) })}
              className={fieldClass('upstream')}
            />
            <span className="field-hint">
              규칙에 매칭되지 않는 모든 요청이 이리로 갑니다. 로컬은 포트가 필요하고
              (<code>localhost:3000</code>), 원격은 스킴이 필요합니다 (<code>https://api.example.com</code>).
            </span>
            <FieldIssues issues={issuesFor(issues, 'upstream')} />
          </label>

          <div className="field">
            <div className="field-label-row">
              <span className="field-label">경로 규칙</span>
              <button className="btn-ghost" onClick={addRule}>+ 규칙 추가</button>
            </div>
            {draft.rules.length === 0 ? (
              <div className="muted small">
                경로별로 다른 동작이 필요할 때만 추가하세요. (예: /api/* 만 8080으로 분기)
              </div>
            ) : (
              <>
                <div className="rule-list">
                  {draft.rules.map((rule, i) => (
                    <RuleEditor
                      key={i}
                      rule={rule}
                      issues={issuesUnder(issues, `rules[${i}]`)}
                      onChange={(r) => updateRule(i, r)}
                      onRemove={() => removeRule(i)}
                    />
                  ))}
                </div>
                <div className="muted small">
                  프록시 타겟에 관리 중인 도메인(자기 자신 포함)을 넣으면 /etc/hosts 루프를
                  피해 실제 원격 IP로 자동 연결됩니다. Host 헤더와 SNI는 원본 도메인으로 유지됩니다.
                </div>
              </>
            )}
          </div>
        </div>

        <div className="dialog-footer">
          <button className="btn-ghost" onClick={onCancel}>취소</button>
          <button
            className="btn-primary"
            disabled={!isValid}
            onClick={() => onSave(draft)}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  )
}
