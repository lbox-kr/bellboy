import type { Issue } from '../validation'

type Props = { issues: Issue[] }

/** Renders validation messages under a field. Errors first, then warnings. */
export function FieldIssues({ issues }: Props) {
  if (issues.length === 0) return null
  const ordered = [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
  return (
    <>
      {ordered.map((issue, i) => (
        <span key={i} className={issue.level === 'error' ? 'field-error' : 'field-warn'}>
          {issue.message}
        </span>
      ))}
    </>
  )
}
