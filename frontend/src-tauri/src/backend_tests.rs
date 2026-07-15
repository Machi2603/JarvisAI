use super::{
    format_extension_import_failure, format_missing_rust_toolchain, format_port_unavailable,
    format_uv_sync_failure, format_uv_sync_spawn_error, should_hide_on_close, uv_sync_stderr_tail,
    DESKTOP_UV_SYNC_COMMAND,
};
use std::path::Path;
#[test]
fn only_the_main_window_hides_instead_of_exiting() {
    assert!(should_hide_on_close("main"));
    assert!(!should_hide_on_close("settings"));
}

#[test]
fn tail_returns_whole_string_when_shorter_than_limit() {
    assert_eq!(uv_sync_stderr_tail("short error", 800), "short error");
}

#[test]
fn tail_keeps_the_end_not_the_beginning() {
    // uv's actionable line is at the end; the spinner noise is at the start.
    let s = format!("{}ACTUAL ERROR HERE", "spinner-noise ".repeat(200));
    let tail = uv_sync_stderr_tail(&s, 40);
    assert!(tail.ends_with("ACTUAL ERROR HERE"), "tail was: {tail:?}");
    assert!(!tail.contains("spinner-noise spinner-noise spinner-noise"));
    assert!(tail.chars().count() <= 40);
}

#[test]
fn tail_trims_surrounding_whitespace() {
    assert_eq!(uv_sync_stderr_tail("  \n padded \n  ", 800), "padded");
}

#[test]
fn tail_never_splits_a_multibyte_codepoint() {
    // Each "é" is 2 bytes / 1 char. A byte-based slice could panic or
    // produce invalid UTF-8; the char-based tail must not.
    let s = "é".repeat(500);
    let tail = uv_sync_stderr_tail(&s, 100);
    assert_eq!(tail.chars().count(), 100);
    assert!(tail.chars().all(|c| c == 'é'));
}
#[test]
fn failure_message_includes_exit_code_and_tail_and_hint() {
    let msg = format_uv_sync_failure(
        Path::new("/home/u/.openjarvis/src"),
        Some(2),
        "error: failed to resolve numpy==2.1.3",
    );
    assert!(msg.contains("exit 2"));
    assert!(msg.contains("/home/u/.openjarvis/src"));
    assert!(msg.contains("failed to resolve numpy==2.1.3"));
    assert!(msg.contains(DESKTOP_UV_SYNC_COMMAND)); // actionable next step
}

#[test]
fn failure_message_renders_missing_exit_code_as_unknown() {
    // Process killed by signal → no exit code. Must not show a misleading -1.
    let msg = format_uv_sync_failure(Path::new("/x"), None, "boom");
    assert!(msg.contains("exit unknown"));
    assert!(!msg.contains("exit -1"));
}

#[test]
fn spawn_error_names_the_binary_and_root() {
    let msg = format_uv_sync_spawn_error(
        Path::new("/repo"),
        "C:\\Users\\me\\.local\\bin\\uv.exe",
        "No such file or directory (os error 2)",
    );
    assert!(msg.contains("C:\\Users\\me\\.local\\bin\\uv.exe"));
    assert!(msg.contains("/repo"));
    assert!(msg.contains("No such file or directory"));
}

#[test]
fn missing_rust_toolchain_message_names_cargo_and_installer() {
    let msg = format_missing_rust_toolchain();
    assert!(msg.contains("cargo"));
    assert!(msg.contains("https://rustup.rs"));
    assert!(msg.contains("openjarvis_rust"));
    assert!(msg.contains("Visual Studio Build Tools"));
}

#[test]
fn uv_sync_rust_failure_mentions_toolchain() {
    let msg = format_uv_sync_failure(
        Path::new("C:\\Users\\me\\OpenJarvis"),
        Some(1),
        "maturin failed: linker `link.exe` not found while building openjarvis-rust",
    );
    assert!(msg.contains("exit 1"));
    assert!(msg.contains("link.exe"));
    assert!(msg.contains("https://rustup.rs"));
    assert!(msg.contains("Visual Studio Build Tools"));
}

#[test]
fn extension_import_failure_names_verification_command() {
    let msg = format_extension_import_failure(
        Path::new("C:\\Users\\me\\OpenJarvis"),
        "ModuleNotFoundError: No module named 'openjarvis_rust'",
    );
    assert!(msg.contains("openjarvis_rust"));
    assert!(msg.contains(DESKTOP_UV_SYNC_COMMAND));
    assert!(msg.contains("uv run python -c \"import openjarvis_rust\""));
    assert!(msg.contains("ModuleNotFoundError"));
}

#[test]
fn port_unavailable_message_names_port_and_owner_hint() {
    let msg = format_port_unavailable(8000, "address already in use");
    assert!(msg.contains("Port 8000 is not available"));
    assert!(msg.contains("address already in use"));
    assert!(msg.contains("To identify it"));
    assert!(msg.contains("8000"));
}

#[test]
fn prepare_subprocess_for_appimage_no_appimage_is_safe() {
    let _guard = APPIMAGE_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let prev = std::env::var_os("APPIMAGE");
    // SAFETY: APPIMAGE_ENV_LOCK serialises every test that touches
    // this env var, so the mutation is single-threaded for the
    // duration of the lock. The 2024-edition env mutation rules
    // require the `unsafe` block but the guard makes it sound.
    unsafe {
        std::env::remove_var("APPIMAGE");
    }
    let mut cmd = tokio::process::Command::new(HARMLESS_BIN);
    super::prepare_subprocess_for_appimage(&mut cmd);
    if let Some(v) = prev {
        unsafe {
            std::env::set_var("APPIMAGE", v);
        }
    }
}

#[cfg(target_os = "linux")]
#[test]
fn prepare_subprocess_for_appimage_with_appimage_set_is_safe() {
    let _guard = APPIMAGE_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let prev = std::env::var_os("APPIMAGE");
    unsafe {
        std::env::set_var("APPIMAGE", "/tmp/test.AppImage");
    }
    let mut cmd = tokio::process::Command::new(HARMLESS_BIN);
    super::prepare_subprocess_for_appimage(&mut cmd);
    unsafe {
        if let Some(v) = prev {
            std::env::set_var("APPIMAGE", v);
        } else {
            std::env::remove_var("APPIMAGE");
        }
    }
}

// -----------------------------------------------------------------
// #455 — AppImage subprocess env-strip helper
// -----------------------------------------------------------------
static APPIMAGE_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(target_os = "windows")]
const HARMLESS_BIN: &str = "cmd";
#[cfg(not(target_os = "windows"))]
const HARMLESS_BIN: &str = "/bin/true";
