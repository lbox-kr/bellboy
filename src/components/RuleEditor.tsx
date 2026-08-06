import type { ProxyEnvPreset, Rule } from '../types'
import type { Issue } from '../validation'
import { issuesFor, normalizePath, normalizeRoot, normalizeTarget } from '../validation'
import { FieldIssues } from './FieldIssues'

type Props = {
  rule: Rule
  /** Issues for this rule, with the `rules[i].` prefix already stripped. */
  issues: Issue[]
  onChange: (rule: Rule) => void
  onRemove: () => void
}

export function RuleEditor({ rule, issues, onChange, onRemove }: Props) {
  const setKind = (kind: Rule['kind']) => {
    if (kind === rule.kind) return
    if (kind === 'proxy') onChange({ kind, path: rule.path, target: 'localhost:8080' })
    else if (kind === 'static') onChange({ kind, path: rule.path, root: '' })
    else onChange({ kind, path: rule.path })
  }

  const addEnvPreset = () => {
    if (rule.kind !== 'proxy') return
    const preset: ProxyEnvPreset = { name: '', target: rule.target }
    onChange({ ...rule, envs: [...(rule.envs ?? []), preset] })
  }

  const updateEnvPreset = (i: number, preset: ProxyEnvPreset) => {
    if (rule.kind !== 'proxy') return
    const envs = (rule.envs ?? []).map((e, j) => (j === i ? preset : e))
    onChange({ ...rule, envs })
  }

  const removeEnvPreset = (i: number) => {
    if (rule.kind !== 'proxy') return
    onChange({ ...rule, envs: (rule.envs ?? []).filter((_, j) => j !== i) })
  }

  const activateEnvPreset = (target: string) => {
    if (rule.kind !== 'proxy') return
    onChange({ ...rule, target })
  }

  const hasError = (field: string) => issuesFor(issues, field).some((i) => i.level === 'error')
  const inputClass = (base: string, field: string) =>
    hasError(field) ? `${base} invalid` : base

  return (
    <div className="rule-entry">
      <div className="rule-row">
        <select
          value={rule.kind}
          onChange={(e) => setKind(e.target.value as Rule['kind'])}
          className="rule-kind"
        >
          <option value="proxy">프록시</option>
          <option value="static">정적 파일</option>
          <option value="bypass">제외(404)</option>
        </select>

        <input
          type="text"
          value={rule.path}
          placeholder="/api/*"
          onChange={(e) => onChange({ ...rule, path: e.target.value })}
          onBlur={(e) => onChange({ ...rule, path: normalizePath(e.target.value) })}
          className={inputClass('rule-path', 'path')}
        />

        {rule.kind === 'proxy' && (
          <input
            type="text"
            value={rule.target}
            placeholder="localhost:8080 또는 https://api.example.com"
            onChange={(e) => onChange({ ...rule, target: e.target.value })}
            onBlur={(e) => onChange({ ...rule, target: normalizeTarget(e.target.value) })}
            className={inputClass('rule-value', 'target')}
          />
        )}

        {rule.kind === 'static' && (
          <input
            type="text"
            value={rule.root}
            placeholder="/Users/me/project/public"
            onChange={(e) => onChange({ ...rule, root: e.target.value })}
            onBlur={(e) => onChange({ ...rule, root: normalizeRoot(e.target.value) })}
            className={inputClass('rule-value', 'root')}
          />
        )}

        {rule.kind === 'bypass' && <div className="rule-value muted">(요청 차단)</div>}

        <button className="btn-ghost danger icon" onClick={onRemove} aria-label="규칙 삭제">
          ×
        </button>
      </div>

      {issues.some((i) => !i.field.startsWith('envs[')) && (
        <div className="rule-messages">
          <FieldIssues issues={issues.filter((i) => !i.field.startsWith('envs['))} />
        </div>
      )}

      {rule.kind === 'proxy' && (
        <div className="rule-envs">
          <div className="rule-envs-header">
            <span>환경 프리셋</span>
            <button className="btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={addEnvPreset}>
              + 추가
            </button>
          </div>
          {(rule.envs ?? []).length === 0 ? (
            <span className="muted small">프리셋을 추가하면 SiteCard에서 원클릭으로 환경 전환할 수 있습니다.</span>
          ) : (
            (rule.envs ?? []).map((env, i) => {
              const envIssues = issues
                .filter((issue) => issue.field.startsWith(`envs[${i}].`))
                .map((issue) => ({ ...issue, field: issue.field.slice(`envs[${i}].`.length) }))
              return (
                <div key={i}>
                  <div className="env-preset-row">
                    <input
                      type="text"
                      value={env.name}
                      placeholder="로컬"
                      onChange={(e) => updateEnvPreset(i, { ...env, name: e.target.value })}
                      onBlur={(e) => updateEnvPreset(i, { ...env, name: e.target.value.trim() })}
                      className={
                        envIssues.some((issue) => issue.field === 'name' && issue.level === 'error')
                          ? 'env-preset-name invalid'
                          : 'env-preset-name'
                      }
                    />
                    <input
                      type="text"
                      value={env.target}
                      placeholder="localhost:8080"
                      onChange={(e) => updateEnvPreset(i, { ...env, target: e.target.value })}
                      onBlur={(e) => updateEnvPreset(i, { ...env, target: normalizeTarget(e.target.value) })}
                      className={
                        envIssues.some((issue) => issue.field === 'target' && issue.level === 'error')
                          ? 'env-preset-target invalid'
                          : 'env-preset-target'
                      }
                    />
                    <button
                      className={`env-chip ${env.target === rule.target ? 'active' : ''}`}
                      onClick={() => activateEnvPreset(env.target)}
                      title="이 환경 활성화"
                    >
                      {env.target === rule.target ? '적용 중' : '적용'}
                    </button>
                    <button className="btn-ghost danger icon" onClick={() => removeEnvPreset(i)} aria-label="프리셋 삭제">
                      ×
                    </button>
                  </div>
                  {envIssues.length > 0 && (
                    <div className="rule-messages env-messages">
                      <FieldIssues issues={envIssues} />
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
