//! Remembered library roots, and the security-scoped bookmarks that reopen them.
//!
//! Under the App Store sandbox a bare path is worthless after a relaunch: only
//! a bookmark minted while the open panel's grant was live gets the folder
//! back. Bookmarks are bound to the app that created them, so they cannot be
//! handed to the core — the shell resolves one and starts its access, and the
//! already-running core inherits it without a respawn.
//!
//! The Developer ID build has no bookmarks entitlement, so minting fails there
//! and every entry keeps a bare path.

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

const MAX_ROOTS: usize = 5;

#[derive(Default)]
pub struct Roots {
    /// Access ends when the URL is released, so these are held until the app
    /// exits.
    open_by_path: Mutex<HashMap<String, Retained<NSURL>>>,
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

/// Only a missing file reads as empty: treating an unreadable one that way and
/// then saving over it would destroy the bookmarks.
fn load(app: &AppHandle) -> Result<Store, String> {
    let path = store_path(app)?;
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Store::default()),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    serde_json::from_slice(&bytes).map_err(|e| format!("{} is unreadable: {e}", path.display()))
}

/// Temp file and rename: a plain write truncates first, and the whole store is
/// rewritten every time a root opens.
fn save(app: &AppHandle, store: &Store) -> Result<(), String> {
    let path = store_path(app)?;
    let temp = path.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(&temp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&temp, &path).map_err(|e| e.to_string())
}

fn mint(url: &NSURL) -> Result<String, String> {
    let data = url
        .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope,
            None,
            None,
        )
        .map_err(|e| e.localizedDescription().to_string())?;
    Ok(BASE64_STANDARD.encode(data.to_vec()))
}

/// The bool is macOS asking for the bookmark to be re-minted.
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

/// An unreadable store is an empty picker rather than an error page, and the
/// open panel is the only way back from one.
#[tauri::command]
pub fn list_roots(app: AppHandle) -> Vec<String> {
    load(&app)
        .unwrap_or_default()
        .roots
        .into_iter()
        .map(|entry| entry.path)
        .collect()
}

/// Call before the core is asked to scan the root. No bookmark needs no work:
/// either this build is unsandboxed, or the panel's grant is still live.
///
/// A bookmark that no longer works is dropped rather than reported, or it is a
/// dead end: the core never runs, so nothing ever re-mints it.
#[tauri::command]
pub fn open_root(app: AppHandle, roots: State<'_, Roots>, path: String) -> Result<(), String> {
    if roots.open_by_path.lock().unwrap().contains_key(&path) {
        return Ok(());
    }
    let mut store = load(&app)?;
    let Some(index) = store.roots.iter().position(|entry| entry.path == path) else {
        return Ok(());
    };
    let Some(encoded) = store.roots[index].bookmark.clone() else {
        return Ok(());
    };
    let Ok((url, stale)) = resolve(&encoded) else {
        return forget_bookmark(&app, store, index);
    };
    if !unsafe { url.startAccessingSecurityScopedResource() } {
        return forget_bookmark(&app, store, index);
    }
    // From the resolved URL, not the stored path: stale means the folder moved.
    // Best effort, because macOS has already granted it.
    if stale {
        if let Ok(fresh) = mint(&url) {
            store.roots[index].bookmark = Some(fresh);
            let _ = save(&app, &store);
        }
    }
    roots.open_by_path.lock().unwrap().insert(path, url);
    Ok(())
}

fn forget_bookmark(app: &AppHandle, mut store: Store, index: usize) -> Result<(), String> {
    store.roots[index].bookmark = None;
    let _ = save(app, &store);
    Ok(())
}

#[tauri::command]
pub fn remember_root(app: AppHandle, path: String) -> Result<(), String> {
    let mut store = load(&app)?;
    let previous = store
        .roots
        .iter()
        .position(|entry| entry.path == path)
        .map(|index| store.roots.remove(index));
    let bookmark = previous
        .and_then(|entry| entry.bookmark)
        .or_else(|| mint(&NSURL::fileURLWithPath(&NSString::from_str(&path))).ok());
    store.roots.insert(0, Entry { path, bookmark });
    store.roots.truncate(MAX_ROOTS);
    save(&app, &store)
}
