//! maw-plugin-sdk — Rust bindings for maw WASM command plugins.
//!
//! Provides typed wrappers around the host functions injected by the maw
//! runtime (`maw_print`, `maw_identity`, `maw_send`, …) so plugin authors
//! can write idiomatic Rust instead of raw `extern "C"` calls.
//!
//! # Quick start
//!
//! ```rust,ignore
//! use maw_plugin_sdk as maw;
//!
//! #[no_mangle]
//! pub extern "C" fn handle(ptr: *const u8, len: usize) -> i32 {
//!     let args = maw::read_args(ptr, len);
//!     let id = maw::identity();
//!     maw::print(&format!("Hello from {}!\n", id.node));
//!     0
//! }
//! ```

use serde::Deserialize;
use std::alloc::{alloc, Layout};

// ---------------------------------------------------------------------------
// Host function declarations (provided by maw runtime via importObject.env)
// ---------------------------------------------------------------------------

extern "C" {
    /// Print a UTF-8 string to stdout.
    fn maw_print(ptr: *const u8, len: usize);

    /// Print a UTF-8 string to stderr.
    fn maw_print_err(ptr: *const u8, len: usize);

    /// Structured log. level: 0=debug, 1=info, 2=warn, 3=error.
    fn maw_log(level: i32, ptr: *const u8, len: usize);

    /// Return a pointer to a length-prefixed JSON string with node identity.
    /// Layout: [u32 LE length][utf-8 bytes]
    fn maw_identity() -> *const u8;

    /// Return a pointer to a length-prefixed JSON string with federation status.
    fn maw_federation() -> *const u8;

    /// Send a message to a target agent. Returns 1 on success, 0 on failure.
    fn maw_send(t_ptr: *const u8, t_len: usize, m_ptr: *const u8, m_len: usize) -> i32;

    /// Fetch a URL (GET). Returns an async-result ID; poll with maw_async_result.
    fn maw_fetch(url_ptr: *const u8, url_len: usize) -> i32;

    /// Check if an async result is ready. Returns ptr to result or 0 if pending.
    fn maw_async_result(id: i32) -> *const u8;
}

// ---------------------------------------------------------------------------
// Exported allocator — the host calls this to write return values into our
// linear memory.
// ---------------------------------------------------------------------------

/// Allocator exported to the host. The host calls `maw_alloc(size)` to
/// reserve space in our linear memory before writing return data.
#[no_mangle]
pub extern "C" fn maw_alloc(size: usize) -> *mut u8 {
    let layout = Layout::from_size_align(size, 1).expect("bad layout");
    unsafe { alloc(layout) }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Read a length-prefixed string written by the host.
/// Format: first 4 bytes = u32 LE length, then UTF-8 bytes.
fn read_host_string(ptr: *const u8) -> String {
    if ptr.is_null() {
        return String::new();
    }
    unsafe {
        let len_bytes: [u8; 4] = [
            *ptr,
            *ptr.add(1),
            *ptr.add(2),
            *ptr.add(3),
        ];
        let len = u32::from_le_bytes(len_bytes) as usize;
        let data = core::slice::from_raw_parts(ptr.add(4), len);
        String::from_utf8_lossy(data).into_owned()
    }
}

// ---------------------------------------------------------------------------
// Public API — typed wrappers
// ---------------------------------------------------------------------------

/// Print a string to stdout (via the host).
pub fn print(msg: &str) {
    unsafe { maw_print(msg.as_ptr(), msg.len()) }
}

/// Print a string to stderr (via the host).
pub fn eprint(msg: &str) {
    unsafe { maw_print_err(msg.as_ptr(), msg.len()) }
}

/// Structured log at the given level (0=debug, 1=info, 2=warn, 3=error).
pub fn log(level: i32, msg: &str) {
    unsafe { maw_log(level, msg.as_ptr(), msg.len()) }
}

/// Convenience: log at debug level.
pub fn debug(msg: &str) { log(0, msg); }
/// Convenience: log at info level.
pub fn info(msg: &str) { log(1, msg); }
/// Convenience: log at warn level.
pub fn warn(msg: &str) { log(2, msg); }
/// Convenience: log at error level.
pub fn error(msg: &str) { log(3, msg); }

/// Query the node identity from the host. Returns a typed `Identity`.
pub fn identity() -> Identity {
    let ptr = unsafe { maw_identity() };
    let json = read_host_string(ptr);
    serde_json::from_str(&json).unwrap_or_else(|e| {
        eprint(&format!("[maw-sdk] failed to parse identity: {e}\n"));
        Identity::default()
    })
}

/// Query federation status from the host.
pub fn federation() -> FederationStatus {
    let ptr = unsafe { maw_federation() };
    let json = read_host_string(ptr);
    serde_json::from_str(&json).unwrap_or_else(|e| {
        eprint(&format!("[maw-sdk] failed to parse federation: {e}\n"));
        FederationStatus::default()
    })
}

/// Send a message to a named agent. Returns true on success.
pub fn send(target: &str, message: &str) -> bool {
    let result = unsafe {
        maw_send(
            target.as_ptr(), target.len(),
            message.as_ptr(), message.len(),
        )
    };
    result == 1
}

/// Start an async HTTP GET. Returns an ID to poll with `async_result()`.
pub fn fetch(url: &str) -> i32 {
    unsafe { maw_fetch(url.as_ptr(), url.len()) }
}

/// Poll for an async result by ID. Returns `Some(body)` when ready, `None` if pending.
pub fn async_result(id: i32) -> Option<String> {
    let ptr = unsafe { maw_async_result(id) };
    if ptr.is_null() || ptr as usize == 0 {
        None
    } else {
        Some(read_host_string(ptr))
    }
}

/// Parse the argument array passed to `handle(ptr, len)` by the host.
/// The host writes a JSON-encoded `string[]` into shared memory.
pub fn read_args(ptr: *const u8, len: usize) -> Vec<String> {
    if ptr.is_null() || len == 0 {
        return Vec::new();
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    let json = String::from_utf8_lossy(data);
    serde_json::from_str(&json).unwrap_or_default()
}

/// Write a string result to linear memory and return a pointer for the host.
/// The returned pointer points to a null-terminated UTF-8 string that the
/// host reads back as the command output.
pub fn write_result(s: &str) -> *const u8 {
    let bytes = s.as_bytes();
    let layout = Layout::from_size_align(bytes.len() + 1, 1).expect("bad layout");
    unsafe {
        let ptr = alloc(layout);
        core::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        *ptr.add(bytes.len()) = 0; // null terminator
        ptr
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Node identity returned by the host.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub node: String,
    pub version: String,
    #[serde(default)]
    pub agents: Vec<String>,
    #[serde(default)]
    pub clock_utc: String,
    #[serde(default)]
    pub uptime: u64,
}

/// Federation status returned by the host.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FederationStatus {
    #[serde(default)]
    pub local_url: String,
    #[serde(default)]
    pub peers: Vec<Peer>,
    #[serde(default)]
    pub total_peers: u32,
    #[serde(default)]
    pub reachable_peers: u32,
}

/// A federation peer.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    pub url: String,
    #[serde(default)]
    pub node: String,
    #[serde(default)]
    pub latency_ms: f64,
    #[serde(default)]
    pub alive: bool,
}
