use crate::backend::{
    boot_backend, find_project_root, resolve_bin, spawn_jarvis_stderr_drainer, SetupStatus,
    SharedBackend, SharedStatus, StderrTail,
};

use crate::JARVIS_PORT;

use std::sync::Arc;

use std::time::Duration;

use tokio::sync::Mutex;

// ---------------------------------------------------------------------------

fn api_base() -> String {
    format!("http://127.0.0.1:{}", JARVIS_PORT)
}

#[tauri::command]
pub(crate) async fn get_setup_status(
    state: tauri::State<'_, SharedStatus>,
) -> Result<SetupStatus, String> {
    Ok(state.lock().await.clone())
}

#[tauri::command]
pub(crate) fn get_api_base() -> String {
    api_base()
}

#[tauri::command]
pub(crate) async fn start_backend(
    backend: tauri::State<'_, SharedBackend>,
    status: tauri::State<'_, SharedStatus>,
) -> Result<(), String> {
    backend.lock().await.stop_all().await;
    *status.lock().await = SetupStatus::starting("groq");
    let b = backend.inner().clone();
    let s = status.inner().clone();
    tauri::async_runtime::spawn(boot_backend(b, s));
    Ok(())
}

#[tauri::command]
pub(crate) async fn stop_backend(backend: tauri::State<'_, SharedBackend>) -> Result<(), String> {
    backend.lock().await.stop_all().await;
    Ok(())
}

#[tauri::command]
pub(crate) async fn check_health(
    _api_url: String,
    backend: tauri::State<'_, SharedBackend>,
) -> Result<serde_json::Value, String> {
    if !backend.lock().await.jarvis_is_running() {
        return Err("Jarvis backend is not running.".into());
    }
    let url = format!("{}/health", api_base());
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    resp.json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))
}

#[tauri::command]
pub(crate) async fn fetch_energy(api_url: String) -> Result<serde_json::Value, String> {
    let base = if api_url.is_empty() {
        api_base()
    } else {
        api_url
    };
    let resp = reqwest::get(format!("{}/v1/telemetry/energy", base))
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    resp.json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))
}

#[tauri::command]
pub(crate) async fn fetch_telemetry(api_url: String) -> Result<serde_json::Value, String> {
    let base = if api_url.is_empty() {
        api_base()
    } else {
        api_url
    };
    let resp = reqwest::get(format!("{}/v1/telemetry/stats", base))
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    resp.json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))
}

#[tauri::command]
pub(crate) async fn fetch_traces(api_url: String, limit: u32) -> Result<serde_json::Value, String> {
    let base = if api_url.is_empty() {
        api_base()
    } else {
        api_url
    };
    let resp = reqwest::get(format!("{}/v1/traces?limit={}", base, limit))
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    resp.json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))
}

#[tauri::command]
pub(crate) async fn fetch_trace(
    api_url: String,
    trace_id: String,
) -> Result<serde_json::Value, String> {
    let base = if api_url.is_empty() {
        api_base()
    } else {
        api_url
    };
    let resp = reqwest::get(format!("{}/v1/traces/{}", base, trace_id))
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    resp.json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))
}

#[tauri::command]
pub(crate) async fn fetch_learning_stats(api_url: String) -> Result<serde_json::Value, String> {
    let base = if api_url.is_empty() {
        api_base()
    } else {
        api_url
    };
    let resp = reqwest::get(format!("{}/v1/learning/stats", base))
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    resp.json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))
}

#[tauri::command]
pub(crate) async fn fetch_learning_policy(api_url: String) -> Result<serde_json::Value, String> {
    let base = if api_url.is_empty() {
        api_base()
    } else {
        api_url
    };
    let resp = reqwest::get(format!("{}/v1/learning/policy", base))
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    resp.json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))
}

#[tauri::command]
pub(crate) async fn fetch_memory_stats(api_url: String) -> Result<serde_json::Value, String> {
    let base = if api_url.is_empty() {
        api_base()
    } else {
        api_url
    };
    let resp = reqwest::get(format!("{}/v1/memory/stats", base))
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    resp.json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))
}

#[tauri::command]
pub(crate) async fn search_memory(
    api_url: String,
    query: String,
    top_k: u32,
) -> Result<serde_json::Value, String> {
    let base = if api_url.is_empty() {
        api_base()
    } else {
        api_url
    };
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/v1/memory/search", base))
        .json(&serde_json::json!({"query": query, "top_k": top_k}))
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    resp.json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))
}

#[tauri::command]
pub(crate) async fn fetch_agents(api_url: String) -> Result<serde_json::Value, String> {
    let base = if api_url.is_empty() {
        api_base()
    } else {
        api_url
    };
    let resp = reqwest::get(format!("{}/v1/agents", base))
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    resp.json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))
}

#[tauri::command]
pub(crate) async fn fetch_models(api_url: String) -> Result<serde_json::Value, String> {
    let base = if api_url.is_empty() {
        api_base()
    } else {
        api_url
    };
    let resp = reqwest::get(format!("{}/v1/models", base))
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    resp.json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))
}

#[tauri::command]
pub(crate) async fn run_jarvis_command(args: Vec<String>) -> Result<String, String> {
    let uv_bin = resolve_bin("uv");

    let mut cmd_args = vec!["run".to_string(), "jarvis".to_string()];
    cmd_args.extend(args.iter().cloned());

    let mut cmd = tokio::process::Command::new(&uv_bin);
    cmd.args(&cmd_args);
    // Run from the project root so `uv run jarvis` resolves the OpenJarvis
    // project regardless of the app's launch cwd. In a packaged install the
    // cwd isn't the checkout, so without this `jarvis` isn't found and the
    // backend never starts — the UI then shows "Failed to get response"
    // (see #531).
    if let Some(ref root) = find_project_root() {
        cmd.current_dir(root);
    }

    let is_serve = args.first().map(|a| a.as_str() == "serve").unwrap_or(false);

    if !is_serve {
        // Short-lived command (e.g. `stop`, `status`): wait for it and return
        // its captured output.
        let output = cmd
            .output()
            .await
            .map_err(|e| format!("Failed to launch jarvis: {}", e))?;
        return if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        };
    }

    // `jarvis serve` is a long-running server that never exits. The old code
    // used `.output()`, which waits for the process to exit and so hung this
    // command forever — the "Start" button never resolved (#531). Spawn it
    // detached instead, drain stderr (a full 4 KB Windows pipe can otherwise
    // stall the child mid-startup, #309), and poll /health for readiness.
    cmd.stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to launch jarvis serve: {}", e))?;

    let tail: StderrTail = Arc::new(Mutex::new(Vec::new()));
    if let Some(stderr) = child.stderr.take() {
        spawn_jarvis_stderr_drainer(stderr, tail.clone());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
    let url = format!("http://127.0.0.1:{}/health", JARVIS_PORT);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(120);

    loop {
        // Surface an early crash (bad venv, missing Rust ext, etc.) right away
        // instead of waiting out the full readiness timeout.
        if let Ok(Some(status)) = child.try_wait() {
            let stderr = String::from_utf8_lossy(tail.lock().await.as_slice()).into_owned();
            return Err(format!(
                "jarvis serve exited (code {:?}) before becoming healthy:\n{}",
                status.code(),
                stderr.trim()
            ));
        }
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                // Leave the server running (the Child is detached on drop —
                // kill_on_drop defaults to false); `stop` tears it down.
                return Ok(format!(
                    "jarvis serve is ready on http://127.0.0.1:{}",
                    JARVIS_PORT
                ));
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "jarvis serve did not become healthy on port {} within 120s.",
                JARVIS_PORT
            ));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

#[tauri::command]
pub(crate) async fn fetch_savings(api_url: String) -> Result<serde_json::Value, String> {
    let base = if api_url.is_empty() {
        api_base()
    } else {
        api_url
    };
    let resp = reqwest::get(format!("{}/v1/savings", base))
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    resp.json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))
}

/// Transcribe audio via the speech API endpoint.
#[tauri::command]
pub(crate) async fn transcribe_audio(
    api_url: String,
    audio_data: Vec<u8>,
    filename: String,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/v1/speech/transcribe", api_url);
    let client = reqwest::Client::new();

    let part = reqwest::multipart::Part::bytes(audio_data)
        .file_name(filename)
        .mime_str("audio/webm")
        .map_err(|e| format!("Failed to create multipart: {}", e))?;

    let form = reqwest::multipart::Form::new().part("file", part);

    let resp = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;
    if !status.is_success() {
        let detail = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| {
                value
                    .get("detail")
                    .and_then(|detail| detail.as_str())
                    .map(str::to_string)
            })
            .filter(|detail| !detail.is_empty())
            .unwrap_or(body);
        return Err(format!(
            "Transcription failed ({}): {}",
            status.as_u16(),
            detail
        ));
    }
    serde_json::from_str(&body).map_err(|e| format!("Invalid response: {}", e))
}

/// Submit savings to Supabase leaderboard.
#[tauri::command]
pub(crate) async fn submit_savings(
    supabase_url: String,
    supabase_key: String,
    payload: serde_json::Value,
) -> Result<bool, String> {
    if supabase_url.is_empty() || supabase_key.is_empty() {
        return Ok(false);
    }
    let client = reqwest::Client::new();
    let resp = client
        .post(format!(
            "{}/rest/v1/savings_entries?on_conflict=anon_id",
            supabase_url
        ))
        .header("Content-Type", "application/json")
        .header("apikey", &supabase_key)
        .header("Authorization", format!("Bearer {}", supabase_key))
        .header("Prefer", "resolution=merge-duplicates")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Supabase POST failed: {}", e))?;
    Ok(resp.status().is_success())
}

// ---------------------------------------------------------------------------

/// Check speech backend health.
#[tauri::command]
pub(crate) async fn speech_health(api_url: String) -> Result<serde_json::Value, String> {
    let url = format!("{}/v1/speech/health", api_url);
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;
    Ok(body)
}

// ---------------------------------------------------------------------------
