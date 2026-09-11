//! The roots store: every folder the user has granted, newest first, with the
//! security-scoped bookmark that gets the app back into it on the next launch.

use serde::{Deserialize, Serialize};
use std::path::Path;

const KEEP: usize = 5;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RootEntry {
    pub path: String,
    pub name: String,
    #[serde(default)]
    pub bookmark: Option<Vec<u8>>,
}

impl RootEntry {
    pub fn new(path: String, bookmark: Option<Vec<u8>>) -> Self {
        let name = Path::new(&path)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        Self {
            path,
            name,
            bookmark,
        }
    }
}

/// A missing file is an empty store. Any other failure is an error: under the
/// sandbox these bookmarks are the only way back into a folder, so a store
/// that cannot be read must never be mistaken for one with nothing in it.
pub fn load(file: &Path) -> Result<Vec<RootEntry>, String> {
    match std::fs::read(file) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| format!("roots store {} is unreadable: {e}", file.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("roots store {}: {e}", file.display())),
    }
}

pub fn save(file: &Path, entries: &[RootEntry]) -> Result<(), String> {
    let describe = |e: std::io::Error| format!("roots store {}: {e}", file.display());
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(describe)?;
    }
    let bytes = serde_json::to_vec_pretty(entries).map_err(|e| e.to_string())?;
    let temp = file.with_extension("json.tmp");
    std::fs::write(&temp, bytes).map_err(describe)?;
    std::fs::rename(&temp, file).map_err(describe)
}

pub fn remember(entries: &mut Vec<RootEntry>, entry: RootEntry) {
    entries.retain(|existing| existing.path != entry.path);
    entries.insert(0, entry);
    entries.truncate(KEEP);
}

pub fn forget(entries: &mut Vec<RootEntry>, path: &str) {
    entries.retain(|existing| existing.path != path);
}

pub fn drop_bookmark(entries: &mut [RootEntry], path: &str) {
    if let Some(entry) = entries.iter_mut().find(|existing| existing.path == path) {
        entry.bookmark = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_store(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "photopipe-roots-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join("roots.json")
    }

    #[test]
    fn missing_store_is_empty() {
        assert_eq!(load(&temp_store("missing")).unwrap(), Vec::new());
    }

    #[test]
    fn save_then_load_round_trips_newest_first() {
        let file = temp_store("roundtrip");
        let mut entries = Vec::new();
        remember(&mut entries, RootEntry::new("/a/old".into(), Some(vec![1, 2])));
        remember(&mut entries, RootEntry::new("/b/new".into(), None));
        save(&file, &entries).unwrap();
        let loaded = load(&file).unwrap();
        assert_eq!(loaded, entries);
        assert_eq!(loaded[0].name, "new");
        assert_eq!(loaded[1].bookmark, Some(vec![1, 2]));
        assert!(!file.with_extension("json.tmp").exists());
    }

    #[test]
    fn remembering_again_moves_to_front_and_caps() {
        let mut entries = Vec::new();
        for i in 0..7 {
            remember(&mut entries, RootEntry::new(format!("/r{i}"), None));
        }
        assert_eq!(entries.len(), KEEP);
        assert_eq!(entries[0].path, "/r6");
        remember(&mut entries, RootEntry::new("/r3".into(), Some(vec![9])));
        assert_eq!(entries[0].path, "/r3");
        assert_eq!(entries[0].bookmark, Some(vec![9]));
        assert_eq!(entries.iter().filter(|e| e.path == "/r3").count(), 1);
    }

    #[test]
    fn dropping_a_broken_bookmark_keeps_the_entry() {
        let mut entries = vec![RootEntry::new("/gone".into(), Some(vec![1]))];
        drop_bookmark(&mut entries, "/gone");
        assert_eq!(entries[0].bookmark, None);
        assert_eq!(entries[0].path, "/gone");
        forget(&mut entries, "/gone");
        assert!(entries.is_empty());
    }

    #[test]
    fn unreadable_store_is_an_error_not_an_empty_store() {
        let file = temp_store("corrupt");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, b"{not json").unwrap();
        assert!(load(&file).unwrap_err().contains("unreadable"));

        let dir = temp_store("directory");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(load(&dir).is_err());
    }
}
