use crate::model::Config;
use anyhow::{Context, Result};
use std::path::PathBuf;

pub fn app_dir() -> Result<PathBuf> {
    let home = std::env::var("HOME").context("HOME not set")?;
    let dir = PathBuf::from(home).join("Library/Application Support/bellboy");
    std::fs::create_dir_all(&dir).context("failed to create app dir")?;
    Ok(dir)
}

pub fn config_path() -> Result<PathBuf> {
    Ok(app_dir()?.join("config.json"))
}

pub fn caddyfile_path() -> Result<PathBuf> {
    Ok(app_dir()?.join("Caddyfile"))
}

pub fn load() -> Result<Config> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(Config::default());
    }
    let text = std::fs::read_to_string(&path).context("read config.json")?;
    if text.trim().is_empty() {
        return Ok(Config::default());
    }
    let mut config: Config = serde_json::from_str(&text).context("parse config.json")?;

    // Older builds let proxy targets omit the scheme. Write back the one the
    // old renderer inferred so validation doesn't reject a config the user
    // never had a chance to fix. Persist it so this runs once; a failed write
    // (read-only dir, etc.) is not worth failing the load over.
    if crate::migrate::apply(&mut config) {
        let _ = save(&config);
    }
    Ok(config)
}

pub fn save(config: &Config) -> Result<()> {
    let path = config_path()?;
    let text = serde_json::to_string_pretty(config)?;
    std::fs::write(path, text)?;
    Ok(())
}
