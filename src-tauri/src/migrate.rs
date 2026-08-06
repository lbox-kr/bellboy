//! One-shot migrations for configs written by older builds.
//!
//! Until v0.1.3 a proxy target could omit the scheme, and `caddyfile.rs`
//! filled one in implicitly: `https://` when the target host was one of the
//! managed site domains (the documented "point a rule at the real remote"
//! pattern), plain http otherwise — Caddy's own default when it dials a
//! scheme-less upstream.
//!
//! Validation now requires an explicit scheme on remote targets, which would
//! reject every config written before that change and lock the user out of
//! *any* save — including turning the offending site off. So we write the
//! scheme the old code inferred, which preserves the previous behaviour
//! exactly.

use crate::model::{Config, Rule};
use std::collections::HashSet;

/// Hosts that resolve to this machine — these never needed a scheme.
const LOCAL_HOSTS: &[&str] = &["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"];

/// Fill in the scheme older builds inferred. Returns true if anything changed.
pub fn apply(config: &mut Config) -> bool {
    // Every site domain counts as managed, not just the enabled ones: a
    // disabled site would have taken the same path once switched back on.
    let managed: HashSet<String> = config
        .sites
        .iter()
        .map(|s| s.domain.trim().to_lowercase())
        .collect();

    let mut changed = false;
    for site in &mut config.sites {
        changed |= add_scheme(&mut site.upstream, &managed);
        for rule in &mut site.rules {
            if let Rule::Proxy { target, envs, .. } = rule {
                changed |= add_scheme(target, &managed);
                for env in envs {
                    changed |= add_scheme(&mut env.target, &managed);
                }
            }
        }
    }
    changed
}

fn add_scheme(target: &mut String, managed: &HashSet<String>) -> bool {
    let raw = target.trim();
    if raw.is_empty() || raw.contains("://") {
        return false;
    }

    let host = host_of(raw);
    if host.is_empty() || LOCAL_HOSTS.contains(&host.as_str()) {
        return false;
    }

    // Managed domains were dialled over https by the old renderer; everything
    // else fell through to Caddy's plain-http default.
    let scheme = if managed.contains(&host) { "https://" } else { "http://" };
    *target = format!("{}{}", scheme, raw);
    true
}

/// Host portion of a `host[:port]` value, lowercased. Ports are the only
/// suffix we need to strip — paths were never valid here.
fn host_of(value: &str) -> String {
    let authority = value.split(['/', '?', '#']).next().unwrap_or(value);
    if let Some(close) = authority.find(']') {
        if authority.starts_with('[') {
            return authority[..=close].to_lowercase();
        }
    }
    match authority.rsplit_once(':') {
        Some((h, p)) if !h.is_empty() && !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => {
            h.to_lowercase()
        }
        _ => authority.to_lowercase(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ProxyEnvPreset, Site};

    fn site(domain: &str, upstream: &str, rules: Vec<Rule>) -> Site {
        Site {
            id: "id".into(),
            domain: domain.into(),
            upstream: upstream.into(),
            enabled: true,
            rules,
        }
    }

    fn proxy(target: &str) -> Rule {
        Rule::Proxy {
            path: "/api/*".into(),
            target: target.into(),
            envs: vec![],
        }
    }

    fn target_of(config: &Config, site: usize, rule: usize) -> String {
        match &config.sites[site].rules[rule] {
            Rule::Proxy { target, .. } => target.clone(),
            _ => panic!("not a proxy rule"),
        }
    }

    #[test]
    fn managed_domain_target_becomes_https() {
        // The exact shape that locked the app up: a rule pointing at its own
        // site domain, which the old renderer dialled over https.
        let mut config = Config {
            sites: vec![site(
                "dev.lfind.io.kr",
                "localhost:3000",
                vec![proxy("dev.lfind.io.kr")],
            )],
        };
        assert!(apply(&mut config));
        assert_eq!(target_of(&config, 0, 0), "https://dev.lfind.io.kr");
    }

    #[test]
    fn managed_domain_matches_across_sites_and_disabled_ones() {
        let mut disabled = site("lfind.kr", "localhost:3000", vec![proxy("lfind.kr")]);
        disabled.enabled = false;
        let mut config = Config {
            sites: vec![site("other.test", "localhost:3000", vec![]), disabled],
        };
        assert!(apply(&mut config));
        assert_eq!(target_of(&config, 1, 0), "https://lfind.kr");
    }

    #[test]
    fn unmanaged_remote_target_becomes_http() {
        // Caddy dials scheme-less upstreams over http, so that is what the
        // old config actually did.
        let mut config = Config {
            sites: vec![site(
                "app.test",
                "localhost:3000",
                vec![proxy("api.example.com:8080")],
            )],
        };
        assert!(apply(&mut config));
        assert_eq!(target_of(&config, 0, 0), "http://api.example.com:8080");
    }

    #[test]
    fn local_and_explicit_targets_are_left_alone() {
        let mut config = Config {
            sites: vec![site(
                "app.test",
                "localhost:3000",
                vec![
                    proxy("localhost:8080"),
                    proxy("127.0.0.1:9000"),
                    proxy("https://api.example.com"),
                    proxy("http://api.example.com"),
                ],
            )],
        };
        assert!(!apply(&mut config));
        assert_eq!(target_of(&config, 0, 0), "localhost:8080");
        assert_eq!(target_of(&config, 0, 2), "https://api.example.com");
    }

    #[test]
    fn env_presets_and_upstreams_migrate_too() {
        let mut config = Config {
            sites: vec![site(
                "app.test",
                "staging.example.com",
                vec![Rule::Proxy {
                    path: "/api/*".into(),
                    target: "https://api.example.com".into(),
                    envs: vec![
                        ProxyEnvPreset {
                            name: "로컬".into(),
                            target: "localhost:8080".into(),
                        },
                        ProxyEnvPreset {
                            name: "자기 자신".into(),
                            target: "app.test".into(),
                        },
                    ],
                }],
            )],
        };
        assert!(apply(&mut config));
        assert_eq!(config.sites[0].upstream, "http://staging.example.com");
        match &config.sites[0].rules[0] {
            Rule::Proxy { envs, .. } => {
                assert_eq!(envs[0].target, "localhost:8080");
                assert_eq!(envs[1].target, "https://app.test");
            }
            _ => panic!("not a proxy rule"),
        }
    }

    #[test]
    fn is_idempotent() {
        let mut config = Config {
            sites: vec![site("app.test", "localhost:3000", vec![proxy("app.test")])],
        };
        assert!(apply(&mut config));
        assert!(!apply(&mut config));
        assert_eq!(target_of(&config, 0, 0), "https://app.test");
    }
}
