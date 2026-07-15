use crate::backend::{boot_backend, home_dir, SetupStatus, SharedBackend, SharedStatus};

use crate::{JARVIS_PORT, OLLAMA_PORT};

use std::time::Duration;

pub(crate) const GROQ_MODEL: &str = "openai/gpt-oss-120b";
/// Small, fast model used when startup needs a default Ollama tag.
pub(crate) const STARTUP_MODEL: &str = "qwen3.5:4b";

/// Tiny fallback model if even the startup model can't be pulled.
pub(crate) const FALLBACK_MODEL: &str = "qwen3:0.6b";

/// Qwen3.5 model variants, ordered smallest to largest.
/// Each entry is (ollama_tag, approximate_download_size_gb, min_ram_gb).
const QWEN35_MODELS: &[(&str, f64, f64)] = &[
    ("qwen3.5:0.8b", 1.0, 4.0),
    ("qwen3.5:2b", 2.7, 6.0),
    ("qwen3.5:4b", 3.4, 8.0),
    ("qwen3.5:9b", 6.6, 12.0),
    ("qwen3.5:27b", 17.0, 24.0),
    ("qwen3.5:35b", 24.0, 32.0),
    ("qwen3.5:122b", 81.0, 96.0),
];

/// Get total system RAM in GB.
pub(crate) fn total_ram_gb() -> f64 {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("sysctl").args(["-n", "hw.memsize"]).output() {
            if let Ok(s) = String::from_utf8(output.stdout) {
                if let Ok(bytes) = s.trim().parse::<u64>() {
                    return bytes as f64 / (1024.0 * 1024.0 * 1024.0);
                }
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(contents) = std::fs::read_to_string("/proc/meminfo") {
            for line in contents.lines() {
                if line.starts_with("MemTotal:") {
                    if let Some(kb_str) = line.split_whitespace().nth(1) {
                        if let Ok(kb) = kb_str.parse::<u64>() {
                            return kb as f64 / (1024.0 * 1024.0);
                        }
                    }
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // wmic returns TotalVisibleMemorySize in KB
        if let Ok(output) = Command::new("wmic")
            .args(["OS", "get", "TotalVisibleMemorySize", "/value"])
            .output()
        {
            if let Ok(s) = String::from_utf8(output.stdout) {
                for line in s.lines() {
                    if let Some(val) = line.strip_prefix("TotalVisibleMemorySize=") {
                        if let Ok(kb) = val.trim().parse::<u64>() {
                            return kb as f64 / (1024.0 * 1024.0);
                        }
                    }
                }
            }
        }
    }
    8.0
}

/// Return the Qwen3.5 models that fit in `ram_gb`, smallest first.
fn models_that_fit_in(ram_gb: f64) -> Vec<&'static str> {
    QWEN35_MODELS
        .iter()
        .filter(|(_, _, min_ram)| ram_gb >= *min_ram)
        .map(|(tag, _, _)| *tag)
        .collect()
}

/// The default local model: the second-largest Qwen3.5 model that fits in
/// `ram_gb`. Falls back to the only fitting model, or FALLBACK_MODEL if none
/// fit. Deliberately NOT the largest — leaves RAM headroom for the OS/app.
fn default_local_model(ram_gb: f64) -> &'static str {
    let fitting = models_that_fit_in(ram_gb);
    match fitting.len() {
        0 => FALLBACK_MODEL,
        1 => fitting[0],
        n => fitting[n - 2],
    }
}

/// A resolved boot plan derived purely from the inference config + RAM.
/// Pure and side-effect-free so it can be unit-tested without spawning
/// processes or touching the network.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BootPlan {
    /// Whether to start and wait for the bundled Ollama.
    pub(crate) launch_ollama: bool,
    /// The preferred Ollama model (None for custom endpoints).
    pub(crate) model_to_pull: Option<String>,
    /// Optional `(engine_key, bare_host)` override for a custom endpoint,
    /// e.g. `("lmstudio", "http://localhost:1234")`. Written into
    /// ~/.openjarvis/config.toml so `jarvis serve` picks it up.
    pub(crate) engine_host: Option<(String, String)>,
    /// Args appended after `uv run jarvis serve --port <port>`.
    pub(crate) serve_args: Vec<String>,
}

/// Default OpenAI-compatible engine key used when a custom endpoint config
/// omits one (LM Studio is the canonical local server).
const CUSTOM_FALLBACK_ENGINE: &str = "lmstudio";

/// Decide what to launch/pull/serve from the inference config + system RAM.
/// Pure: no I/O, no spawning.
pub(crate) fn boot_plan(cfg: &InferenceConfig, ram_gb: f64) -> BootPlan {
    match cfg.kind {
        SourceKind::Groq => BootPlan {
            launch_ollama: false,
            model_to_pull: None,
            engine_host: None,
            serve_args: vec![
                "--engine".into(),
                "groq".into(),
                "--model".into(),
                cfg.model.clone().unwrap_or_else(|| GROQ_MODEL.to_string()),
                "--agent".into(),
                "native_react".into(),
            ],
        },
        SourceKind::OpenAi | SourceKind::Anthropic | SourceKind::Gemini => {
            let model = cfg.model.clone().unwrap_or_default();
            BootPlan {
                launch_ollama: false,
                model_to_pull: None,
                engine_host: None,
                serve_args: vec![
                    "--engine".into(),
                    "cloud".into(),
                    "--model".into(),
                    model,
                    "--agent".into(),
                    "native_react".into(),
                ],
            }
        }
        SourceKind::Ollama => {
            let model = cfg
                .model
                .clone()
                .unwrap_or_else(|| default_local_model(ram_gb).to_string());
            BootPlan {
                launch_ollama: true,
                model_to_pull: Some(model.clone()),
                engine_host: None,
                serve_args: vec![
                    "--engine".into(),
                    "ollama".into(),
                    "--model".into(),
                    model,
                    "--agent".into(),
                    "simple".into(),
                ],
            }
        }
        SourceKind::Custom => {
            let engine = cfg
                .engine
                .clone()
                .unwrap_or_else(|| CUSTOM_FALLBACK_ENGINE.to_string());
            // Record (engine_key, bare_host) only when a host is configured, so
            // boot can write `[engine.<key>] host = ...` into config.toml. An
            // empty host is dropped (no override).
            let engine_host = cfg
                .host
                .clone()
                .filter(|h| !h.is_empty())
                .map(|h| (engine.clone(), h));
            // `model` may be empty if the config is malformed; `jarvis serve`
            // surfaces a clear error then (there is no universal default model
            // for an arbitrary endpoint).
            let model = cfg.model.clone().unwrap_or_default();
            BootPlan {
                launch_ollama: false,
                model_to_pull: None,
                engine_host,
                serve_args: vec![
                    "--engine".into(),
                    engine,
                    "--model".into(),
                    model,
                    "--agent".into(),
                    "simple".into(),
                ],
            }
        }
    }
}

/// Get the user home directory, handling both Unix (HOME) and Windows (USERPROFILE).

pub(crate) async fn ollama_has_model(model: &str) -> bool {
    let models = ollama_model_names().await;
    matching_installed_model(&models, model).is_some()
}

fn parse_ollama_model_names(body: &serde_json::Value) -> Vec<String> {
    body.get("models")
        .and_then(|m| m.as_array())
        .map(|models| {
            models
                .iter()
                .filter_map(|m| {
                    m.get("name")
                        .or_else(|| m.get("model"))
                        .and_then(|n| n.as_str())
                })
                .filter(|name| !name.trim().is_empty())
                .map(|name| name.to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn model_names_match(installed: &str, requested: &str) -> bool {
    installed == requested
        || installed.strip_suffix(":latest") == Some(requested)
        || requested.strip_suffix(":latest") == Some(installed)
}

fn matching_installed_model(models: &[String], requested: &str) -> Option<String> {
    models
        .iter()
        .find(|model| model_names_match(model, requested))
        .cloned()
}

fn model_name_looks_embedding_only(model: &str) -> bool {
    let name = model.to_ascii_lowercase();
    [
        "embed",
        "embedding",
        "rerank",
        "minilm",
        "bge-",
        "bge_",
        "e5-",
        "e5_",
    ]
    .iter()
    .any(|marker| name.contains(marker))
}

pub(crate) fn preferred_installed_model(models: &[String]) -> Option<String> {
    models
        .iter()
        .find(|model| !model.trim().is_empty() && !model_name_looks_embedding_only(model))
        .or_else(|| models.iter().find(|model| !model.trim().is_empty()))
        .cloned()
}

pub(crate) fn startup_installed_model(
    requested_model: &str,
    installed_models: &[String],
) -> Option<String> {
    matching_installed_model(installed_models, requested_model)
        .or_else(|| preferred_installed_model(installed_models))
}

pub(crate) fn should_persist_resolved_model(cfg: &InferenceConfig) -> bool {
    cfg.model
        .as_deref()
        .map(|model| model.trim().is_empty())
        .unwrap_or(true)
}

pub(crate) async fn ollama_model_names() -> Vec<String> {
    let url = format!("http://127.0.0.1:{}/api/tags", OLLAMA_PORT);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    if let Ok(resp) = client.get(&url).send().await {
        if let Ok(body) = resp.json::<serde_json::Value>().await {
            return parse_ollama_model_names(&body);
        }
    }
    Vec::new()
}

pub(crate) async fn pull_model(model: &str) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{}/api/pull", OLLAMA_PORT);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(&url)
        .json(&serde_json::json!({"name": model, "stream": false}))
        .send()
        .await
        .map_err(|e| format!("Pull request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Pull returned status {}", resp.status()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

const SECURE_KEY_SERVICE: &str = "OpenJarvis Cloud Keys";
const MANAGED_CLOUD_KEY_NAMES: &[&str] = &[
    "GROQ_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "OPENROUTER_API_KEY",
    "MINIMAX_API_KEY",
    "TAVILY_API_KEY",
];

/// Legacy path used by older desktop builds. New saves never write here.
fn legacy_cloud_keys_path() -> std::path::PathBuf {
    let home = home_dir();
    std::path::PathBuf::from(home)
        .join(".openjarvis")
        .join("cloud-keys.env")
}

fn validate_cloud_key_name(key_name: &str) -> Result<(), String> {
    let valid = !key_name.is_empty()
        && key_name.len() <= 128
        && key_name.ends_with("_API_KEY")
        && key_name
            .chars()
            .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == '_');
    if valid {
        Ok(())
    } else {
        Err(format!("Invalid API key name: {}", key_name))
    }
}

fn engine_api_key_name(engine: &str) -> String {
    let normalized: String = engine
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = normalized.trim_matches('_');
    let engine_name = if trimmed.is_empty() {
        CUSTOM_FALLBACK_ENGINE.to_ascii_uppercase()
    } else {
        trimmed.to_string()
    };
    format!("{}_API_KEY", engine_name)
}

fn managed_cloud_key_names() -> Vec<String> {
    let mut names: Vec<String> = MANAGED_CLOUD_KEY_NAMES
        .iter()
        .map(|name| (*name).to_string())
        .collect();

    let cfg = read_inference_config();
    if matches!(&cfg.kind, SourceKind::Custom) {
        let engine = cfg
            .engine
            .unwrap_or_else(|| CUSTOM_FALLBACK_ENGINE.to_string());
        let key_name = engine_api_key_name(&engine);
        if validate_cloud_key_name(&key_name).is_ok() {
            names.push(key_name);
        }
    }

    names.sort();
    names.dedup();
    names
}

pub(crate) fn secure_store_get(key_name: &str) -> Result<Option<String>, String> {
    validate_cloud_key_name(key_name)?;
    let entry = keyring::Entry::new(SECURE_KEY_SERVICE, key_name).map_err(|err| {
        format!(
            "Failed to open secure key storage for {}: {}",
            key_name, err
        )
    })?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!(
            "Failed to read {} from secure key storage: {}",
            key_name, err
        )),
    }
}

fn secure_store_set(key_name: &str, key_value: &str) -> Result<(), String> {
    validate_cloud_key_name(key_name)?;
    let entry = keyring::Entry::new(SECURE_KEY_SERVICE, key_name).map_err(|err| {
        format!(
            "Failed to open secure key storage for {}: {}",
            key_name, err
        )
    })?;
    if key_value.is_empty() {
        return match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(format!(
                "Failed to remove {} from secure key storage: {}",
                key_name, err
            )),
        };
    }
    entry
        .set_password(key_value)
        .map_err(|err| format!("Failed to save {} in secure key storage: {}", key_name, err))
}

fn read_legacy_cloud_keys() -> Vec<(String, String)> {
    let path = legacy_cloud_keys_path();
    let mut keys = Vec::new();
    if let Ok(contents) = std::fs::read_to_string(&path) {
        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((k, v)) = line.split_once('=') {
                keys.push((k.trim().to_string(), v.trim().to_string()));
            }
        }
    }
    keys
}

fn migrate_legacy_cloud_keys() {
    let path = legacy_cloud_keys_path();
    if !path.exists() {
        return;
    }

    let legacy_keys = read_legacy_cloud_keys();
    if legacy_keys.is_empty() {
        let _ = std::fs::remove_file(&path);
        return;
    }

    let mut migrated_all = true;
    for (key, value) in legacy_keys {
        if value.is_empty() {
            continue;
        }
        if secure_store_set(&key, &value).is_err() {
            migrated_all = false;
        }
    }

    if migrated_all {
        let _ = std::fs::remove_file(path);
    }
}

/// Read cloud keys from secure desktop storage and return key=value pairs.
pub(crate) fn read_cloud_keys() -> Vec<(String, String)> {
    migrate_legacy_cloud_keys();
    managed_cloud_key_names()
        .into_iter()
        .filter_map(|key| match secure_store_get(&key) {
            Ok(Some(value)) if !value.is_empty() => Some((key, value)),
            _ => None,
        })
        .collect()
}

async fn reload_cloud_keys(keys: Vec<(String, String)>) {
    let reload_url = format!("http://127.0.0.1:{}/v1/cloud/reload", JARVIS_PORT);
    let key_map: serde_json::Map<String, serde_json::Value> = keys
        .into_iter()
        .map(|(key, value)| (key, serde_json::Value::String(value)))
        .collect();
    let _ = reqwest::Client::new()
        .post(&reload_url)
        .json(&serde_json::json!({ "keys": key_map }))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await;
}

/// Save a single cloud API key to secure desktop storage.
#[tauri::command]
pub(crate) async fn save_cloud_key(
    key_name: String,
    key_value: String,
    backend: tauri::State<'_, SharedBackend>,
    status: tauri::State<'_, SharedStatus>,
) -> Result<(), String> {
    let key_value = key_value.trim().to_string();
    secure_store_set(&key_name, &key_value)?;

    // Tell the running server to hot-reload its cloud engine so the user
    // doesn't need to restart the app after entering an API key.
    reload_cloud_keys(vec![(key_name.clone(), key_value)]).await;

    let cfg = read_inference_config();
    let active_key = provider_key_name(cfg.kind);
    let key_matches_active = active_key == Some(key_name.as_str());
    if key_matches_active {
        backend.lock().await.stop_all().await;
        let source = provider_name(cfg.kind);
        if cfg
            .model
            .as_deref()
            .map(str::trim)
            .is_some_and(|model| !model.is_empty())
            && secure_store_get(key_name.as_str())?.is_some()
        {
            *status.lock().await = SetupStatus::starting(source);
            tauri::async_runtime::spawn(boot_backend(
                backend.inner().clone(),
                status.inner().clone(),
            ));
        } else {
            *status.lock().await = SetupStatus::unconfigured(source);
        }
    }

    Ok(())
}

/// Get which cloud providers have keys configured (without exposing values).
#[tauri::command]
pub(crate) async fn get_cloud_key_status() -> Result<serde_json::Value, String> {
    migrate_legacy_cloud_keys();
    let status: Vec<serde_json::Value> = managed_cloud_key_names()
        .into_iter()
        .map(|key| {
            let set = matches!(secure_store_get(&key), Ok(Some(value)) if !value.is_empty());
            serde_json::json!({ "key": key, "set": set })
        })
        .collect();
    Ok(serde_json::json!(status))
}

/// Return the current inference-source config for the Settings UI.
#[tauri::command]
pub(crate) async fn get_inference_source() -> Result<InferenceConfig, String> {
    Ok(read_inference_config())
}

/// Persist the chosen inference source. `host` is normalized to a bare base
/// URL. For custom endpoints, an optional API key is stored in secure desktop
/// storage under `<ENGINE>_API_KEY`. Applies on next app launch.
#[tauri::command]
pub(crate) async fn set_inference_source(
    kind: String,
    model: Option<String>,
    host: Option<String>,
    engine: Option<String>,
    api_key: Option<String>,
) -> Result<(), String> {
    let kind = match kind.as_str() {
        "groq" => SourceKind::Groq,
        "openai" => SourceKind::OpenAi,
        "anthropic" => SourceKind::Anthropic,
        "gemini" | "google" => SourceKind::Gemini,
        "ollama" => SourceKind::Ollama,
        "custom" => SourceKind::Custom,
        other => return Err(format!("Unknown inference source kind: {:?}", other)),
    };
    let cfg = InferenceConfig {
        kind,
        model: model
            .filter(|m| !m.trim().is_empty())
            .or_else(|| matches!(kind, SourceKind::Groq).then(|| GROQ_MODEL.to_string())),
        host: host.map(|h| normalize_host(&h)).filter(|h| !h.is_empty()),
        engine: engine.filter(|e| !e.is_empty()),
    };
    if let SourceKind::Custom = cfg.kind {
        if cfg.host.is_none() {
            return Err("A server URL is required for a custom endpoint.".into());
        }
        if cfg.model.as_deref().unwrap_or("").is_empty() {
            return Err("A model name is required for a custom endpoint.".into());
        }
        if let Some(key) = api_key.filter(|k| !k.is_empty()) {
            let engine = cfg
                .engine
                .clone()
                .unwrap_or_else(|| CUSTOM_FALLBACK_ENGINE.to_string());
            let key_name = engine_api_key_name(&engine);
            // Save the key before persisting the config: if the key can't be
            // written, surface it and DON'T record a custom source whose
            // credential is missing (which would fail confusingly at runtime).
            secure_store_set(&key_name, &key)
                .map_err(|e| format!("Could not store the API key: {}", e))?;
        }
    } else if let Some(key_name) = provider_key_name(cfg.kind) {
        if let Some(key) = api_key.filter(|key| !key.trim().is_empty()) {
            secure_store_set(key_name, &key)
                .map_err(|e| format!("Could not store the API key: {}", e))?;
        }
    }
    write_inference_config(&cfg)
}

/// Pull a model via Ollama (called from frontend download button).
#[tauri::command]
pub(crate) async fn pull_ollama_model(model_name: String) -> Result<serde_json::Value, String> {
    pull_model(&model_name)
        .await
        .map_err(|e| format!("Failed to pull {}: {}", model_name, e))?;
    Ok(serde_json::json!({"status": "ok", "model": model_name}))
}

/// Delete a model from Ollama.
#[tauri::command]
pub(crate) async fn delete_ollama_model(model_name: String) -> Result<serde_json::Value, String> {
    let url = format!("http://127.0.0.1:{}/api/delete", OLLAMA_PORT);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .delete(&url)
        .json(&serde_json::json!({"name": model_name}))
        .send()
        .await
        .map_err(|e| format!("Delete failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Delete returned status {}", resp.status()));
    }
    Ok(serde_json::json!({"status": "deleted", "model": model_name}))
}

// ---------------------------------------------------------------------------
// Inference-source selection (~/.openjarvis/inference.json)
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SourceKind {
    Groq,
    OpenAi,
    Anthropic,
    Gemini,
    Ollama,
    Custom,
}

impl Default for SourceKind {
    fn default() -> Self {
        SourceKind::Groq
    }
}

fn provider_kind(provider: &str) -> Result<SourceKind, String> {
    match provider.trim().to_ascii_lowercase().as_str() {
        "groq" => Ok(SourceKind::Groq),
        "openai" => Ok(SourceKind::OpenAi),
        "anthropic" => Ok(SourceKind::Anthropic),
        "gemini" | "google" => Ok(SourceKind::Gemini),
        other => Err(format!("Unknown provider: {}", other)),
    }
}

pub(crate) fn provider_key_name(kind: SourceKind) -> Option<&'static str> {
    match kind {
        SourceKind::Groq => Some("GROQ_API_KEY"),
        SourceKind::OpenAi => Some("OPENAI_API_KEY"),
        SourceKind::Anthropic => Some("ANTHROPIC_API_KEY"),
        SourceKind::Gemini => Some("GEMINI_API_KEY"),
        SourceKind::Ollama | SourceKind::Custom => None,
    }
}

fn provider_name(kind: SourceKind) -> &'static str {
    match kind {
        SourceKind::Groq => "groq",
        SourceKind::OpenAi => "openai",
        SourceKind::Anthropic => "anthropic",
        SourceKind::Gemini => "gemini",
        SourceKind::Ollama => "ollama",
        SourceKind::Custom => "custom",
    }
}

#[derive(serde::Serialize, Clone, Debug)]
pub(crate) struct ProviderModel {
    pub(crate) id: String,
    pub(crate) name: Option<String>,
}

fn provider_key(kind: SourceKind, candidate_key: Option<&str>) -> Result<String, String> {
    let key_name = provider_key_name(kind).ok_or_else(|| {
        format!(
            "Provider {} does not use a cloud API key",
            provider_name(kind)
        )
    })?;
    if let Some(key) = candidate_key.map(str::trim).filter(|key| !key.is_empty()) {
        return Ok(key.to_string());
    }
    secure_store_get(key_name)?
        .filter(|key| !key.trim().is_empty())
        .ok_or_else(|| format!("No {} API key is configured.", provider_name(kind)))
}

fn parse_provider_models(
    kind: SourceKind,
    body: &str,
) -> Result<(Vec<ProviderModel>, Option<String>), String> {
    let value: serde_json::Value = serde_json::from_str(body).map_err(|error| {
        format!(
            "Invalid {} model catalog response: {error}",
            provider_name(kind)
        )
    })?;
    let models = value
        .get("data")
        .or_else(|| value.get("models"))
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| format!("{} returned no model list", provider_name(kind)))?;
    let result = models
        .iter()
        .filter_map(|model| {
            let raw_id = model
                .get("id")
                .and_then(serde_json::Value::as_str)
                .or_else(|| {
                    model
                        .get("name")
                        .and_then(serde_json::Value::as_str)
                        .map(|name| name.strip_prefix("models/").unwrap_or(name))
                })?;
            if kind == SourceKind::Gemini
                && model
                    .get("supportedGenerationMethods")
                    .and_then(serde_json::Value::as_array)
                    .is_some_and(|methods| {
                        !methods
                            .iter()
                            .any(|method| method.as_str() == Some("generateContent"))
                    })
            {
                return None;
            }
            let id = raw_id.trim();
            (!id.is_empty()).then(|| ProviderModel {
                id: id.to_string(),
                name: model
                    .get("display_name")
                    .or_else(|| model.get("displayName"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect::<Vec<_>>();
    let next = if kind == SourceKind::Gemini {
        value
            .get("nextPageToken")
            .and_then(serde_json::Value::as_str)
            .filter(|token| !token.is_empty())
            .map(str::to_string)
    } else if value
        .get("has_more")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        value
            .get("last_id")
            .and_then(serde_json::Value::as_str)
            .filter(|token| !token.is_empty())
            .map(str::to_string)
    } else {
        None
    };
    Ok((result, next))
}

async fn fetch_provider_models(
    kind: SourceKind,
    candidate_key: Option<&str>,
) -> Result<Vec<ProviderModel>, String> {
    let key = provider_key(kind, candidate_key)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Could not create model catalog client: {error}"))?;
    let mut page_token = None;
    let mut result = Vec::new();

    for _ in 0..20 {
        let mut request = match kind {
            SourceKind::Groq => client.get("https://api.groq.com/openai/v1/models"),
            SourceKind::OpenAi => client.get("https://api.openai.com/v1/models"),
            SourceKind::Anthropic => client
                .get("https://api.anthropic.com/v1/models")
                .header("anthropic-version", "2023-06-01")
                .header("x-api-key", &key),
            SourceKind::Gemini => client
                .get("https://generativelanguage.googleapis.com/v1beta/models")
                .query(&[("key", key.as_str())]),
            SourceKind::Ollama | SourceKind::Custom => {
                return Err(format!("Unsupported provider {}", provider_name(kind)))
            }
        };
        if let Some(token) = page_token.as_deref() {
            request = match kind {
                SourceKind::Gemini => request.query(&[("pageToken", token)]),
                SourceKind::Anthropic => request.query(&[("after_id", token)]),
                SourceKind::Groq | SourceKind::OpenAi => request.query(&[("after", token)]),
                SourceKind::Ollama | SourceKind::Custom => request,
            };
        }
        if !matches!(kind, SourceKind::Anthropic | SourceKind::Gemini) {
            request = request.bearer_auth(&key);
        }
        let response = request
            .send()
            .await
            .map_err(|error| format!("Could not load {} models: {error}", provider_name(kind)))?;
        let status = response.status();
        let body = response.text().await.map_err(|error| {
            format!(
                "Could not read {} model response: {error}",
                provider_name(kind)
            )
        })?;
        if !status.is_success() {
            return Err(format!(
                "{} model catalog returned HTTP {}: {}",
                provider_name(kind),
                status,
                body.chars().take(300).collect::<String>()
            ));
        }
        let (mut models, next) = parse_provider_models(kind, &body)?;
        result.append(&mut models);
        if next.is_none() || next == page_token {
            break;
        }
        page_token = next;
    }
    result.sort_by(|left, right| left.id.cmp(&right.id));
    result.dedup_by(|left, right| left.id == right.id);
    Ok(result)
}

/// Fetch the provider's official model catalog without returning the API key.
#[tauri::command]
pub(crate) async fn list_provider_models(
    provider: String,
    candidate_key: Option<String>,
) -> Result<Vec<ProviderModel>, String> {
    let kind = provider_kind(&provider)?;
    fetch_provider_models(kind, candidate_key.as_deref()).await
}

/// Validate a provider credential, persist the selected model, and restart
/// only the child processes owned by this Tauri instance.
#[tauri::command]
pub(crate) async fn apply_inference_config(
    provider: String,
    model: String,
    candidate_key: Option<String>,
    backend: tauri::State<'_, SharedBackend>,
    status: tauri::State<'_, SharedStatus>,
) -> Result<serde_json::Value, String> {
    let kind = provider_kind(&provider)?;
    let model = model.trim().to_string();
    if model.is_empty() {
        return Err("A model identifier is required.".into());
    }
    let key = provider_key(kind, candidate_key.as_deref())?;
    // The catalog request is the key validation. A non-listed model remains
    // valid because the UI intentionally supports manually entered IDs.
    let _ = fetch_provider_models(kind, Some(&key)).await?;
    if let Some(key_name) = provider_key_name(kind) {
        if candidate_key
            .as_deref()
            .map(str::trim)
            .is_some_and(|key| !key.is_empty())
        {
            secure_store_set(key_name, &key)?;
        }
    }
    let cfg = InferenceConfig {
        kind,
        model: Some(model.clone()),
        host: None,
        engine: None,
    };
    write_inference_config(&cfg)?;

    backend.lock().await.stop_all().await;
    *status.lock().await = SetupStatus::starting(provider_name(kind));
    let backend_ref = backend.inner().clone();
    let status_ref = status.inner().clone();
    tauri::async_runtime::spawn(boot_backend(backend_ref, status_ref));
    Ok(serde_json::json!({ "provider": provider_name(kind), "model": model }))
}

/// Return only whether each supported provider has a stored key.
#[tauri::command]
pub(crate) async fn get_provider_statuses() -> Result<serde_json::Value, String> {
    let mut result = serde_json::Map::new();
    for (provider, kind) in [
        ("groq", SourceKind::Groq),
        ("openai", SourceKind::OpenAi),
        ("anthropic", SourceKind::Anthropic),
        ("gemini", SourceKind::Gemini),
    ] {
        let set = provider_key_name(kind)
            .and_then(|key_name| secure_store_get(key_name).ok().flatten())
            .is_some_and(|key| !key.trim().is_empty());
        result.insert(provider.into(), serde_json::Value::Bool(set));
    }
    Ok(serde_json::Value::Object(result))
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
pub(crate) struct InferenceConfig {
    #[serde(default, rename = "provider", alias = "kind")]
    pub(crate) kind: SourceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) model: Option<String>,
    /// Bare base URL (no trailing `/v1`), custom only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) host: Option<String>,
    /// OpenAI-compatible engine key (e.g. "lmstudio"), custom only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) engine: Option<String>,
}

/// Path to the inference-source config (~/.openjarvis/inference.json).
fn inference_config_path() -> std::path::PathBuf {
    std::path::PathBuf::from(home_dir())
        .join(".openjarvis")
        .join("inference.json")
}

/// Parse config text. Any error (missing/garbage) yields the Ollama default —
/// a broken file must never strand the user with no working inference source.
fn parse_inference_config(text: &str) -> InferenceConfig {
    let mut cfg = serde_json::from_str::<InferenceConfig>(text).unwrap_or_default();
    // Older desktop builds stored `kind: "groq"` without a model. Preserve
    // that user's working choice while writing the new provider-shaped file.
    if cfg.model.is_none() && text.contains("\"kind\"") && !text.contains("\"provider\"") {
        cfg.model = Some(GROQ_MODEL.to_string());
    }
    cfg
}

/// Read the on-disk inference config, or the Ollama default if absent.
pub(crate) fn read_inference_config() -> InferenceConfig {
    match std::fs::read_to_string(inference_config_path()) {
        Ok(text) => {
            let cfg = parse_inference_config(&text);
            if !text.contains("\"provider\"") && cfg.model.is_some() {
                let _ = write_inference_config(&cfg);
            }
            cfg
        }
        Err(_) => InferenceConfig::default(),
    }
}

/// Write the inference config to disk (pretty JSON).
pub(crate) fn write_inference_config(cfg: &InferenceConfig) -> Result<(), String> {
    let path = inference_config_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, json + "\n")
        .map_err(|e| format!("Failed to save inference config: {}", e))
}

/// Upsert `[engine.<engine>] host = "<host>"` into an existing config.toml
/// string, preserving all other content/formatting. Pure: string in, string out.
fn upsert_engine_host(existing: &str, engine: &str, host: &str) -> Result<String, String> {
    let mut doc = existing
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("Invalid config.toml: {}", e))?;
    doc["engine"][engine]["host"] = toml_edit::value(host);
    Ok(doc.to_string())
}

/// Write the custom-endpoint host into ~/.openjarvis/config.toml so
/// `jarvis serve` (which reads that file via load_config) points at it.
/// The `<ENGINE>_HOST` env var is unreliable — it is shadowed by the engine's
/// non-empty default host in the Python layer — so config.toml is the override.
pub(crate) fn set_engine_host_in_config(engine: &str, host: &str) -> Result<(), String> {
    let path = std::path::PathBuf::from(home_dir())
        .join(".openjarvis")
        .join("config.toml");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let updated = upsert_engine_host(&existing, engine, host)?;
    std::fs::write(&path, updated).map_err(|e| format!("Failed to write config.toml: {}", e))
}

/// Normalize a user-entered server URL to a bare base host: trim whitespace,
/// drop a trailing `/v1` segment (the engine re-appends its own api prefix),
/// then drop any trailing slash.
fn normalize_host(raw: &str) -> String {
    let s = raw.trim().trim_end_matches('/');
    let s = s.strip_suffix("/v1").unwrap_or(s);
    s.trim_end_matches('/').to_string()
}

#[cfg(test)]
#[path = "inference_tests.rs"]
mod tests;
