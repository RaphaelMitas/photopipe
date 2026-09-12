use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::Path;

const KEEP: usize = 5;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RootEntry {
    pub path: String,
    pub bookmark: Vec<u8>,
}

/// Corrupt is moved aside and only NotFound reads as empty: these bookmarks are the only way back into a folder.
pub fn load(file: &Path) -> Result<Vec<RootEntry>, String> {
    let describe = |e: std::io::Error| format!("roots store {}: {e}", file.display());
    match std::fs::read(file) {
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(entries) => Ok(entries),
            Err(_) => {
                std::fs::rename(file, file.with_extension("json.corrupt")).map_err(describe)?;
                Ok(Vec::new())
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(describe(e)),
    }
}

pub fn save(file: &Path, entries: &[RootEntry]) -> Result<(), String> {
    let describe = |e: std::io::Error| format!("roots store {}: {e}", file.display());
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(describe)?;
    }
    let bytes = serde_json::to_vec_pretty(entries).map_err(|e| e.to_string())?;
    let temp = file.with_extension("json.tmp");
    let mut out = std::fs::File::create(&temp).map_err(describe)?;
    out.write_all(&bytes).map_err(describe)?;
    // APFS may rename before the data lands; a power cut would leave an empty store.
    out.sync_all().map_err(describe)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn entry(path: &str, bookmark: Vec<u8>) -> RootEntry {
        RootEntry {
            path: path.into(),
            bookmark,
        }
    }

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
        remember(&mut entries, entry("/a/old", vec![1, 2]));
        remember(&mut entries, entry("/b/new", vec![]));
        save(&file, &entries).unwrap();
        let loaded = load(&file).unwrap();
        assert_eq!(loaded, entries);
        assert_eq!(loaded[0].path, "/b/new");
        assert_eq!(loaded[1].bookmark, vec![1, 2]);
        assert!(!file.with_extension("json.tmp").exists());
    }

    #[test]
    fn remembering_again_moves_to_front_and_caps() {
        let mut entries = Vec::new();
        for i in 0..7 {
            remember(&mut entries, entry(&format!("/r{i}"), vec![]));
        }
        assert_eq!(entries.len(), KEEP);
        assert_eq!(entries[0].path, "/r6");
        remember(&mut entries, entry("/r3", vec![9]));
        assert_eq!(entries[0].path, "/r3");
        assert_eq!(entries[0].bookmark, vec![9]);
        assert_eq!(entries.iter().filter(|e| e.path == "/r3").count(), 1);
    }

    #[test]
    fn forgetting_removes_the_entry() {
        let mut entries = vec![entry("/gone", vec![1])];
        forget(&mut entries, "/gone");
        assert!(entries.is_empty());
    }

    #[test]
    fn corrupt_store_is_moved_aside_and_unreadable_store_is_an_error() {
        let file = temp_store("corrupt");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, b"{not json").unwrap();
        assert_eq!(load(&file).unwrap(), Vec::new());
        assert!(!file.exists());
        assert_eq!(
            std::fs::read(file.with_extension("json.corrupt")).unwrap(),
            b"{not json"
        );

        let dir = temp_store("directory");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(load(&dir).is_err());
    }
}
