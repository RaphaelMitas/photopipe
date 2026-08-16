//! Remembered library roots, and the security-scoped bookmarks that reopen them.
//!
//! Under the App Store sandbox a bare path is worthless after a relaunch: only
//! a bookmark minted while the open panel's grant was live gets the folder
//! back. Bookmarks are bound to the app that created them, so they cannot be
//! handed to the core — the shell resolves one and starts its access, and the
//! already-running core inherits it without a respawn.
//!
//! The Developer ID build has no bookmarks entitlement, so minting fails there
//! and every entry keeps a bare path. That build never needed one.

use base64::prelude::*;
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2_foundation::{
    NSData, NSString, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions, NSURL,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// What the picker offers. The head of the list is the root to reopen.
const MAX_ROOTS: usize = 5;

#[derive(Default)]
pub struct Roots {
    /// Access ends when the URL is released, so a root opened this session is
    /// held until the app exits. Keyed by path: reopening the same root twice
    /// must not stack a second extension.
    open: Mutex<HashMap<String, Retained<NSURL>>>,
}

#[derive(Default, Serialize, Deserialize)]
struct Store {
    roots: Vec<Entry>,
}

#[derive(Serialize, Deserialize)]
struct Entry {
    path: String,
    bookmark: Option<String>,
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("roots.json"))
}

fn load(app: &AppHandle) -> Store {
    store_path(app)
        .ok()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, store: &Store) -> Result<(), String> {
    let path = store_path(app)?;
    let json = serde_json::to_vec_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

fn mint(path: &str) -> Result<String, String> {
    let url = NSURL::fileURLWithPath(&NSString::from_str(path));
    let data = url
        .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope,
            None,
            None,
        )
        .map_err(|e| e.localizedDescription().to_string())?;
    Ok(BASE64_STANDARD.encode(data.to_vec()))
}

/// The resolved URL, and whether macOS wants the bookmark re-minted.
fn resolve(encoded: &str) -> Result<(Retained<NSURL>, bool), String> {
    let bytes = BASE64_STANDARD
        .decode(encoded)
        .map_err(|e| format!("stored bookmark is not base64: {e}"))?;
    let mut stale = Bool::NO;
    let url = unsafe {
        NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
            &NSData::with_bytes(&bytes),
            NSURLBookmarkResolutionOptions::WithSecurityScope
                | NSURLBookmarkResolutionOptions::WithoutUI,
            None,
            &mut stale,
        )
    }
    .map_err(|e| e.localizedDescription().to_string())?;
    Ok((url, stale.as_bool()))
}

#[tauri::command]
pub fn list_roots(app: AppHandle) -> Vec<String> {
    load(&app)
        .roots
        .into_iter()
        .map(|entry| entry.path)
        .collect()
}

/// Regain access to a remembered root before the core is asked to scan it.
/// A root with no bookmark needs nothing: either this build is unsandboxed, or
/// the open panel just granted the folder and the grant is still live.
#[tauri::command]
pub fn open_root(app: AppHandle, roots: State<'_, Roots>, path: String) -> Result<(), String> {
    if roots.open.lock().unwrap().contains_key(&path) {
        return Ok(());
    }
    let mut store = load(&app);
    let Some(index) = store.roots.iter().position(|entry| entry.path == path) else {
        return Ok(());
    };
    let Some(encoded) = store.roots[index].bookmark.clone() else {
        return Ok(());
    };
    let (url, stale) = resolve(&encoded)?;
    if !unsafe { url.startAccessingSecurityScopedResource() } {
        return Err(format!("macOS would not reopen {path}"));
    }
    // Re-mint while the access it needs is held, so the next launch resolves
    // cleanly instead of asking again.
    if stale {
        if let Ok(fresh) = mint(&path) {
            store.roots[index].bookmark = Some(fresh);
            save(&app, &store)?;
        }
    }
    roots.open.lock().unwrap().insert(path, url);
    Ok(())
}

/// Record a root the core has accepted, minting its bookmark if this is the
/// first time we have seen it.
#[tauri::command]
pub fn remember_root(app: AppHandle, path: String) -> Result<(), String> {
    let mut store = load(&app);
    let previous = store
        .roots
        .iter()
        .position(|entry| entry.path == path)
        .map(|index| store.roots.remove(index));
    let bookmark = previous
        .and_then(|entry| entry.bookmark)
        .or_else(|| mint(&path).ok());
    store.roots.insert(0, Entry { path, bookmark });
    store.roots.truncate(MAX_ROOTS);
    save(&app, &store)
}
