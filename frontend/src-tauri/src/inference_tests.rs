use super::{
    boot_plan, default_local_model, matching_installed_model, model_names_match, normalize_host,
    parse_inference_config, parse_ollama_model_names, parse_provider_models,
    preferred_installed_model, should_persist_resolved_model, startup_installed_model,
    upsert_engine_host, InferenceConfig, SourceKind, GROQ_MODEL,
};
#[test]
fn default_local_model_picks_second_largest_that_fits() {
    // QWEN35_MODELS min_ram ladder: 4,6,8,12,24,32,96 GB
    assert_eq!(default_local_model(4.0), "qwen3.5:0.8b"); // only one fits
    assert_eq!(default_local_model(8.0), "qwen3.5:2b"); // fits 0.8/2/4 → 2nd-largest
    assert_eq!(default_local_model(16.0), "qwen3.5:4b"); // fits ..9b → 2nd-largest
    assert_eq!(default_local_model(32.0), "qwen3.5:27b"); // fits 0.8/2/4/9/27/35b → 2nd-largest is 27b
    assert_eq!(default_local_model(128.0), "qwen3.5:35b"); // fits all → 2nd-largest
}

#[test]
fn default_local_model_falls_back_when_nothing_fits() {
    assert_eq!(default_local_model(1.0), super::FALLBACK_MODEL);
}

#[test]
fn parse_ollama_model_names_reads_nonempty_names() {
    let body = serde_json::json!({
        "models": [
            {"name": "llama3.2:latest"},
            {"name": ""},
            {"name": "qwen3.5:4b"},
            {"model": "mistral:latest"}
        ]
    });
    assert_eq!(
        parse_ollama_model_names(&body),
        vec![
            "llama3.2:latest".to_string(),
            "qwen3.5:4b".to_string(),
            "mistral:latest".to_string()
        ]
    );
}

#[test]
fn model_names_match_treats_latest_as_optional() {
    assert!(model_names_match("llama3.2:latest", "llama3.2"));
    assert!(model_names_match("llama3.2", "llama3.2:latest"));
    assert!(model_names_match("qwen3.5:4b", "qwen3.5:4b"));
    assert!(!model_names_match("llama3.2:latest", "qwen3.5:4b"));
}

#[test]
fn installed_model_helpers_pick_matching_or_first_model() {
    let models = vec!["llama3.2:latest".to_string(), "qwen3.5:4b".to_string()];
    assert_eq!(
        matching_installed_model(&models, "llama3.2"),
        Some("llama3.2:latest".to_string())
    );
    assert_eq!(
        preferred_installed_model(&models),
        Some("llama3.2:latest".to_string())
    );
}

#[test]
fn preferred_installed_model_skips_embedding_names_when_chat_model_exists() {
    let models = vec![
        "nomic-embed-text:latest".to_string(),
        "llama3.2:latest".to_string(),
    ];
    assert_eq!(
        preferred_installed_model(&models),
        Some("llama3.2:latest".to_string())
    );
}

#[test]
fn startup_installed_model_uses_existing_model_for_defaults() {
    let models = vec!["llama3.2:latest".to_string()];
    assert_eq!(
        startup_installed_model("qwen3.5:4b", &models),
        Some("llama3.2:latest".to_string())
    );
}

#[test]
fn startup_installed_model_uses_existing_model_when_configured_model_missing() {
    let models = vec!["llama3.2:latest".to_string()];
    assert_eq!(
        startup_installed_model("qwen3.5:4b", &models),
        Some("llama3.2:latest".to_string())
    );
}

#[test]
fn resolved_model_is_only_persisted_when_no_model_was_configured() {
    let default_cfg = InferenceConfig {
        kind: SourceKind::Ollama,
        ..Default::default()
    };
    assert!(should_persist_resolved_model(&default_cfg));

    let empty_cfg = InferenceConfig {
        kind: SourceKind::Ollama,
        model: Some(" ".into()),
        ..Default::default()
    };
    assert!(should_persist_resolved_model(&empty_cfg));

    let user_cfg = InferenceConfig {
        kind: SourceKind::Ollama,
        model: Some("qwen3.5:9b".into()),
        ..Default::default()
    };
    assert!(!should_persist_resolved_model(&user_cfg));
}

#[test]
fn parse_defaults_to_groq_when_file_missing_or_garbage() {
    assert!(matches!(parse_inference_config("").kind, SourceKind::Groq));
    assert!(matches!(
        parse_inference_config("not json").kind,
        SourceKind::Groq
    ));
}

#[test]
fn legacy_groq_config_migrates_to_provider_and_default_model_without_secrets() {
    let cfg = parse_inference_config(r#"{"kind":"groq"}"#);
    assert_eq!(cfg.kind, SourceKind::Groq);
    assert_eq!(cfg.model.as_deref(), Some(GROQ_MODEL));
    let json = serde_json::to_string(&cfg).unwrap();
    assert!(json.contains("\"provider\""));
    assert!(!json.contains("API_KEY"));
}

#[test]
fn cloud_boot_plan_uses_cloud_engine_for_each_provider() {
    for kind in [
        SourceKind::OpenAi,
        SourceKind::Anthropic,
        SourceKind::Gemini,
    ] {
        let plan = boot_plan(
            &InferenceConfig {
                kind,
                model: Some("model-id".into()),
                ..Default::default()
            },
            16.0,
        );
        assert!(!plan.launch_ollama);
        assert!(plan
            .serve_args
            .windows(2)
            .any(|window| window == ["--engine", "cloud"]));
        assert!(plan
            .serve_args
            .windows(2)
            .any(|window| window == ["--model", "model-id"]));
    }
}

#[test]
fn provider_catalog_parser_preserves_pagination_and_filters_gemini_embeddings() {
    let (models, next) = parse_provider_models(
        SourceKind::OpenAi,
        r#"{"data":[{"id":"gpt-4o"}],"has_more":true,"last_id":"gpt-4o"}"#,
    )
    .unwrap();
    assert_eq!(models[0].id, "gpt-4o");
    assert_eq!(next.as_deref(), Some("gpt-4o"));

    let (models, next) = parse_provider_models(
        SourceKind::Gemini,
        r#"{"models":[{"name":"models/gemini-2.5-flash","supportedGenerationMethods":["generateContent"]},{"name":"models/text-embedding-004","supportedGenerationMethods":["embedContent"]}],"nextPageToken":"next"}"#,
    )
    .unwrap();
    assert_eq!(
        models
            .iter()
            .map(|model| model.id.as_str())
            .collect::<Vec<_>>(),
        ["gemini-2.5-flash"]
    );
    assert_eq!(next.as_deref(), Some("next"));
}

#[test]
fn boot_plan_groq_skips_ollama_and_uses_direct_api() {
    let plan = boot_plan(&InferenceConfig::default(), 16.0);
    assert!(!plan.launch_ollama);
    assert!(plan.model_to_pull.is_none());
    assert!(plan
        .serve_args
        .windows(2)
        .any(|w| w == ["--engine", "groq"]));
    assert!(plan
        .serve_args
        .windows(2)
        .any(|w| w == ["--model", GROQ_MODEL]));
}

#[test]
fn parse_reads_custom_endpoint() {
    let cfg = parse_inference_config(
        r#"{"kind":"custom","model":"qwen2.5-7b","host":"http://localhost:1234","engine":"lmstudio"}"#,
    );
    assert!(matches!(cfg.kind, SourceKind::Custom));
    assert_eq!(cfg.model.as_deref(), Some("qwen2.5-7b"));
    assert_eq!(cfg.host.as_deref(), Some("http://localhost:1234"));
    assert_eq!(cfg.engine.as_deref(), Some("lmstudio"));
}

#[test]
fn normalize_host_strips_trailing_slash_and_v1() {
    assert_eq!(
        normalize_host("http://localhost:1234/v1"),
        "http://localhost:1234"
    );
    assert_eq!(
        normalize_host("http://localhost:1234/v1/"),
        "http://localhost:1234"
    );
    assert_eq!(
        normalize_host("http://localhost:1234/"),
        "http://localhost:1234"
    );
    assert_eq!(normalize_host("http://host:8000"), "http://host:8000");
}

#[test]
fn boot_plan_ollama_launches_and_pulls_one_model() {
    let cfg = InferenceConfig {
        kind: SourceKind::Ollama,
        ..Default::default()
    };
    let plan = boot_plan(&cfg, 16.0);
    assert!(plan.launch_ollama);
    assert_eq!(plan.model_to_pull.as_deref(), Some("qwen3.5:4b"));
    assert!(plan.engine_host.is_none());
    assert!(plan
        .serve_args
        .windows(2)
        .any(|w| w == ["--engine", "ollama"]));
    assert!(plan
        .serve_args
        .windows(2)
        .any(|w| w == ["--model", "qwen3.5:4b"]));
}

#[test]
fn boot_plan_ollama_respects_pinned_model() {
    let cfg = InferenceConfig {
        kind: SourceKind::Ollama,
        model: Some("qwen3.5:9b".into()),
        ..Default::default()
    };
    let plan = boot_plan(&cfg, 16.0);
    assert_eq!(plan.model_to_pull.as_deref(), Some("qwen3.5:9b"));
}

#[test]
fn boot_plan_custom_skips_ollama_and_sets_engine_host() {
    let cfg = InferenceConfig {
        kind: SourceKind::Custom,
        model: Some("qwen2.5-7b".into()),
        host: Some("http://localhost:1234".into()),
        engine: Some("lmstudio".into()),
    };
    let plan = boot_plan(&cfg, 16.0);
    assert!(!plan.launch_ollama);
    assert!(plan.model_to_pull.is_none());
    assert_eq!(
        plan.engine_host,
        Some(("lmstudio".to_string(), "http://localhost:1234".to_string()))
    );
    assert!(plan
        .serve_args
        .windows(2)
        .any(|w| w == ["--engine", "lmstudio"]));
    assert!(plan
        .serve_args
        .windows(2)
        .any(|w| w == ["--model", "qwen2.5-7b"]));
}

#[test]
fn boot_plan_custom_defaults_engine_to_lmstudio() {
    let cfg = InferenceConfig {
        kind: SourceKind::Custom,
        model: Some("m".into()),
        host: Some("http://h:1".into()),
        engine: None,
    };
    let plan = boot_plan(&cfg, 16.0);
    assert_eq!(plan.engine_host.as_ref().unwrap().0, "lmstudio");
    assert!(plan
        .serve_args
        .windows(2)
        .any(|w| w == ["--engine", "lmstudio"]));
}

#[test]
fn boot_plan_custom_omits_engine_host_when_no_host() {
    // No configured host → don't set engine_host (no override to write).
    let cfg = InferenceConfig {
        kind: SourceKind::Custom,
        model: Some("m".into()),
        host: None,
        engine: Some("lmstudio".into()),
    };
    let plan = boot_plan(&cfg, 16.0);
    assert!(plan.engine_host.is_none());
}

#[test]
fn boot_plan_ollama_uses_fallback_model_on_low_ram() {
    // Below the smallest model's min_ram → default_local_model → FALLBACK_MODEL.
    let cfg = InferenceConfig {
        kind: SourceKind::Ollama,
        ..Default::default()
    };
    let plan = boot_plan(&cfg, 1.0);
    assert_eq!(plan.model_to_pull.as_deref(), Some(super::FALLBACK_MODEL));
}

#[test]
fn upsert_engine_host_writes_into_empty_config() {
    let out = upsert_engine_host("", "lmstudio", "http://localhost:1234").unwrap();
    let doc: toml_edit::DocumentMut = out.parse().unwrap();
    assert_eq!(
        doc["engine"]["lmstudio"]["host"].as_str(),
        Some("http://localhost:1234")
    );
}

#[test]
fn upsert_engine_host_preserves_existing_content() {
    let existing = "[intelligence]\ndefault_model = \"keep-me\"\n";
    let out = upsert_engine_host(existing, "vllm", "http://host:8000").unwrap();
    let doc: toml_edit::DocumentMut = out.parse().unwrap();
    assert_eq!(
        doc["intelligence"]["default_model"].as_str(),
        Some("keep-me")
    );
    assert_eq!(
        doc["engine"]["vllm"]["host"].as_str(),
        Some("http://host:8000")
    );
}

#[test]
fn upsert_engine_host_updates_existing_host() {
    let existing = "[engine.lmstudio]\nhost = \"http://old:1\"\n";
    let out = upsert_engine_host(existing, "lmstudio", "http://new:2").unwrap();
    let doc: toml_edit::DocumentMut = out.parse().unwrap();
    assert_eq!(
        doc["engine"]["lmstudio"]["host"].as_str(),
        Some("http://new:2")
    );
}
