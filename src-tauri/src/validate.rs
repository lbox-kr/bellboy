//! Backend guard for site/rule input.
//!
//! The UI (`src/validation.ts`) is the primary place these rules are enforced —
//! it can point at the offending field while the user types. This module exists
//! for the paths that never touch the UI: a hand-edited `config.json`, or data
//! saved by a build that predates the validation. Keep the two in sync; only
//! `error`-level rules are mirrored here (warnings are a UI affordance).
//!
//! Only **enabled** sites are checked. Disabled sites reach neither the
//! Caddyfile nor /etc/hosts, and refusing to save them would strand a user who
//! turned a broken site off in order to fix it later.

use crate::model::{Config, Rule, Site};
use std::collections::HashSet;

/// Hosts that resolve to this machine — the scheme may be omitted for these.
const LOCAL_HOSTS: &[&str] = &["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"];

/// Reserved names we refuse as a site domain — claiming them breaks the system.
const RESERVED_DOMAINS: &[&str] = &["localhost", "local", "broadcasthost"];

/// Validate every enabled site. Returns all problems joined by newlines so the
/// user sees the whole list rather than fixing them one reload at a time.
pub fn validate_config(config: &Config) -> Result<(), String> {
    let mut problems: Vec<String> = Vec::new();
    let mut seen_domains: HashSet<String> = HashSet::new();

    for site in config.sites.iter().filter(|s| s.enabled) {
        let label = if site.domain.trim().is_empty() {
            "(이름 없는 사이트)".to_string()
        } else {
            site.domain.trim().to_string()
        };

        if let Err(msg) = validate_domain(&site.domain) {
            problems.push(format!("{}: {}", label, msg));
        } else if !seen_domains.insert(site.domain.trim().to_lowercase()) {
            problems.push(format!("{}: 도메인이 중복되었습니다.", label));
        }

        if let Err(msg) = validate_target(&site.upstream, "Upstream") {
            problems.push(format!("{}: {}", label, msg));
        }

        for (i, rule) in site.rules.iter().enumerate() {
            for msg in validate_rule(rule) {
                problems.push(format!("{} 규칙 {}: {}", label, i + 1, msg));
            }
        }
    }

    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems.join("\n"))
    }
}

fn validate_rule(rule: &Rule) -> Vec<String> {
    let mut problems = Vec::new();
    let path = match rule {
        Rule::Proxy { path, .. } | Rule::Static { path, .. } | Rule::Bypass { path } => path,
    };
    if let Err(msg) = validate_path(path) {
        problems.push(msg);
    }

    match rule {
        Rule::Proxy { target, envs, .. } => {
            if let Err(msg) = validate_target(target, "프록시 타겟") {
                problems.push(msg);
            }
            for env in envs {
                if env.name.trim().is_empty() {
                    problems.push("환경 프리셋 이름이 비어 있습니다.".to_string());
                }
                if let Err(msg) = validate_target(&env.target, "프리셋 타겟") {
                    problems.push(msg);
                }
            }
        }
        Rule::Static { root, .. } => {
            if let Err(msg) = validate_root(root) {
                problems.push(msg);
            }
        }
        Rule::Bypass { .. } => {}
    }

    problems
}

fn validate_domain(value: &str) -> Result<(), String> {
    let raw = value.trim();
    if raw.is_empty() {
        return Err("도메인이 비어 있습니다.".into());
    }
    if raw.chars().any(char::is_whitespace) {
        return Err("도메인에 공백을 넣을 수 없습니다.".into());
    }
    if scheme_of(raw).is_some() {
        return Err("도메인에는 http:// 같은 스킴을 넣을 수 없습니다.".into());
    }
    if raw.contains('/') {
        return Err("도메인에 경로를 넣을 수 없습니다.".into());
    }
    if raw.contains(':') {
        return Err("도메인에 포트를 넣을 수 없습니다.".into());
    }
    if raw.contains('*') {
        return Err("와일드카드 도메인은 /etc/hosts 에 등록할 수 없습니다.".into());
    }

    let lower = raw.to_lowercase();
    if RESERVED_DOMAINS.contains(&lower.as_str()) {
        return Err(format!("'{}' 는 시스템 예약 이름이라 사용할 수 없습니다.", lower));
    }
    if !lower.split('.').all(is_domain_label) {
        return Err("도메인은 영문 소문자·숫자·하이픈만 쓸 수 있습니다.".into());
    }
    Ok(())
}

/// Scheme policy: local hosts may omit it but need a port; remote hosts must
/// state it, since defaulting to http against an https-only origin fails at
/// request time rather than at save time.
fn validate_target(value: &str, label: &str) -> Result<(), String> {
    let raw = value.trim();
    if raw.is_empty() {
        return Err(format!("{}이(가) 비어 있습니다.", label));
    }
    if raw.chars().any(char::is_whitespace) {
        return Err(format!("{}에 공백을 넣을 수 없습니다.", label));
    }

    let parsed = parse(raw);
    if let Some(scheme) = &parsed.scheme {
        if scheme != "http" && scheme != "https" {
            return Err(format!("지원하지 않는 스킴입니다: {}://", scheme));
        }
    }
    if !parsed.rest.is_empty() {
        return Err(format!("{}에는 경로·쿼리를 넣을 수 없습니다.", label));
    }
    if parsed.host.is_empty() {
        return Err(format!("{} 형식이 올바르지 않습니다.", label));
    }

    if is_local_host(&parsed.host) {
        if parsed.port.is_none() {
            return Err("로컬 주소에는 포트가 필요합니다. (예: localhost:3000)".into());
        }
    } else if parsed.scheme.is_none() {
        return Err(format!(
            "{}이(가) 원격 주소라면 http:// 또는 https:// 를 붙여야 합니다.",
            label
        ));
    }
    Ok(())
}

fn validate_path(value: &str) -> Result<(), String> {
    let raw = value.trim();
    if raw.is_empty() {
        return Err("경로가 비어 있습니다.".into());
    }
    if raw.chars().any(char::is_whitespace) {
        return Err("경로에 공백을 넣을 수 없습니다.".into());
    }
    if !raw.starts_with('/') {
        return Err("경로는 '/' 로 시작해야 합니다.".into());
    }
    Ok(())
}

fn validate_root(value: &str) -> Result<(), String> {
    let raw = value.trim();
    if raw.is_empty() {
        return Err("정적 파일 경로가 비어 있습니다.".into());
    }
    if !raw.starts_with('/') && !raw.starts_with("~/") {
        return Err("정적 파일 경로는 절대 경로여야 합니다.".into());
    }
    Ok(())
}

fn is_domain_label(label: &str) -> bool {
    !label.is_empty()
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_local_host(host: &str) -> bool {
    LOCAL_HOSTS.contains(&host.to_lowercase().as_str())
}

/// `scheme://` prefix, lowercased, if the value starts with one.
fn scheme_of(value: &str) -> Option<String> {
    let idx = value.find("://")?;
    let scheme = &value[..idx];
    if scheme.is_empty() {
        return None;
    }
    let mut chars = scheme.chars();
    let first = chars.next()?;
    if !first.is_ascii_alphabetic() {
        return None;
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '.' || c == '-') {
        return None;
    }
    Some(scheme.to_lowercase())
}

struct Parsed {
    scheme: Option<String>,
    host: String,
    port: Option<String>,
    rest: String,
}

fn parse(value: &str) -> Parsed {
    let scheme = scheme_of(value);
    let after_scheme = match &scheme {
        Some(s) => &value[s.len() + 3..],
        None => value,
    };

    let (authority, rest) = match after_scheme.find(['/', '?', '#']) {
        Some(i) => (&after_scheme[..i], &after_scheme[i..]),
        None => (after_scheme, ""),
    };

    // Bracketed IPv6 (`[::1]:3000`) keeps its brackets as part of the host.
    if let Some(close) = authority.find(']') {
        if authority.starts_with('[') {
            let host = &authority[..=close];
            let port = authority[close + 1..].strip_prefix(':').and_then(|p| {
                if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) {
                    Some(p.to_string())
                } else {
                    None
                }
            });
            return Parsed {
                scheme,
                host: host.to_string(),
                port,
                rest: rest.to_string(),
            };
        }
    }

    match authority.rsplit_once(':') {
        Some((h, p)) if !h.is_empty() && !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => {
            Parsed {
                scheme,
                host: h.to_string(),
                port: Some(p.to_string()),
                rest: rest.to_string(),
            }
        }
        _ => Parsed {
            scheme,
            host: authority.to_string(),
            port: None,
            rest: rest.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ProxyEnvPreset;

    fn site(domain: &str, upstream: &str, rules: Vec<Rule>) -> Site {
        Site {
            id: "id".into(),
            domain: domain.into(),
            upstream: upstream.into(),
            enabled: true,
            rules,
        }
    }

    fn config(sites: Vec<Site>) -> Config {
        Config { sites }
    }

    #[test]
    fn accepts_a_well_formed_config() {
        let cfg = config(vec![site(
            "myapp.test",
            "localhost:3000",
            vec![
                Rule::Proxy {
                    path: "/api/*".into(),
                    target: "https://api.example.com".into(),
                    envs: vec![ProxyEnvPreset {
                        name: "로컬".into(),
                        target: "localhost:8080".into(),
                    }],
                },
                Rule::Static {
                    path: "/static/*".into(),
                    root: "/Users/me/public".into(),
                },
                Rule::Bypass {
                    path: "/admin/*".into(),
                },
            ],
        )]);
        assert!(validate_config(&cfg).is_ok());
    }

    #[test]
    fn rejects_scheme_port_and_wildcard_in_domain() {
        for domain in ["http://myapp.test", "myapp.test:8443", "*.myapp.test", "localhost"] {
            let cfg = config(vec![site(domain, "localhost:3000", vec![])]);
            assert!(validate_config(&cfg).is_err(), "expected {domain} to fail");
        }
    }

    #[test]
    fn rejects_remote_target_without_scheme() {
        let cfg = config(vec![site(
            "myapp.test",
            "localhost:3000",
            vec![Rule::Proxy {
                path: "/api/*".into(),
                target: "api.example.com".into(),
                envs: vec![],
            }],
        )]);
        let err = validate_config(&cfg).unwrap_err();
        assert!(err.contains("http://"), "{err}");
    }

    #[test]
    fn rejects_local_target_without_port() {
        let cfg = config(vec![site("myapp.test", "localhost", vec![])]);
        assert!(validate_config(&cfg).is_err());
    }

    #[test]
    fn rejects_target_with_path() {
        let cfg = config(vec![site("myapp.test", "localhost:3000/api", vec![])]);
        assert!(validate_config(&cfg).is_err());
    }

    #[test]
    fn rejects_path_without_leading_slash() {
        let cfg = config(vec![site(
            "myapp.test",
            "localhost:3000",
            vec![Rule::Bypass {
                path: "admin/*".into(),
            }],
        )]);
        assert!(validate_config(&cfg).is_err());
    }

    #[test]
    fn rejects_relative_static_root() {
        let cfg = config(vec![site(
            "myapp.test",
            "localhost:3000",
            vec![Rule::Static {
                path: "/static/*".into(),
                root: "public".into(),
            }],
        )]);
        assert!(validate_config(&cfg).is_err());
    }

    #[test]
    fn rejects_duplicate_domains() {
        let cfg = config(vec![
            site("myapp.test", "localhost:3000", vec![]),
            site("MyApp.test", "localhost:4000", vec![]),
        ]);
        assert!(validate_config(&cfg).unwrap_err().contains("중복"));
    }

    #[test]
    fn skips_disabled_sites() {
        let mut broken = site("http://bad", "nope", vec![]);
        broken.enabled = false;
        assert!(validate_config(&config(vec![broken])).is_ok());
    }

    #[test]
    fn reports_every_problem_at_once() {
        let cfg = config(vec![site(
            "http://myapp.test",
            "api.example.com",
            vec![Rule::Bypass {
                path: "admin/*".into(),
            }],
        )]);
        let err = validate_config(&cfg).unwrap_err();
        assert_eq!(err.lines().count(), 3, "{err}");
    }

    #[test]
    fn parses_ipv6_and_non_numeric_suffixes() {
        let v6 = parse("[::1]:3000");
        assert_eq!(v6.host, "[::1]");
        assert_eq!(v6.port.as_deref(), Some("3000"));

        let redis = parse("redis:primary");
        assert_eq!(redis.host, "redis:primary");
        assert!(redis.port.is_none());
    }
}
