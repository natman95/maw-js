use maw_plugin_sdk as maw;

/// Entry point called by the maw runtime.
///
/// `ptr`/`len` point to a JSON-encoded string array of CLI arguments
/// in WASM linear memory (written by the host before calling handle).
///
/// Return 0 for success, or a pointer to a null-terminated result string
/// that the host prints to stdout.
#[no_mangle]
pub extern "C" fn handle(ptr: *const u8, len: usize) -> i32 {
    let args = maw::read_args(ptr, len);

    let id = maw::identity();
    maw::print(&format!("Hello from Rust WASM!\n"));
    maw::print(&format!("  node:    {}\n", id.node));
    maw::print(&format!("  version: {}\n", id.version));
    maw::print(&format!("  agents:  {}\n", id.agents.join(", ")));

    if !args.is_empty() {
        maw::print(&format!("  args:    {}\n", args.join(" ")));
    }

    let fed = maw::federation();
    maw::print(&format!("  peers:   {}/{}\n", fed.reachable_peers, fed.total_peers));

    0
}

// Re-export the SDK's allocator so the host can find it.
pub use maw_plugin_sdk::maw_alloc;
