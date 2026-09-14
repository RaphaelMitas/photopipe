use crate::bookmark::{self, Failure, Live};
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::AllocAnyThread;
use objc2_foundation::{NSString, NSUserDefaults};
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;

const KEY: &str = "roots";
const KEEP: usize = 5;

struct Entry {
    live: Live,
    failure: Option<Failure>,
}

impl Entry {
    fn activate(mut live: Live) -> Self {
        let failure = match bookmark::activate(&live.bookmark) {
            Ok(fresh) => {
                live = fresh;
                None
            }
            Err(failure) => Some(failure),
        };
        Entry { live, failure }
    }

    /// A live folder may have been ejected or renamed since; a failed one may be back.
    fn refresh(&mut self) -> Result<Live, Failure> {
        if self.failure.is_some() || !Path::new(&self.live.path).is_dir() {
            *self = Entry::activate(self.live.clone());
        }
        self.failure.clone().map_or(Ok(self.live.clone()), Err)
    }
}

#[derive(Serialize)]
pub struct Listing {
    pub path: String,
    pub status: &'static str,
}

/// Remembered folders, newest first.
pub struct Roots {
    defaults: Retained<NSUserDefaults>,
    entries: Mutex<Vec<Entry>>,
}

impl Roots {
    pub fn load(suite: Option<&str>) -> Self {
        let defaults = match suite {
            Some(suite) => NSUserDefaults::initWithSuiteName(
                NSUserDefaults::alloc(),
                Some(&NSString::from_str(suite)),
            )
            .expect("suite defaults"),
            None => NSUserDefaults::standardUserDefaults(),
        };
        // only a change to Live makes this unparseable; starting empty beats refusing to launch
        let stored: Vec<Live> = defaults
            .stringForKey(&NSString::from_str(KEY))
            .and_then(|json| serde_json::from_str(&json.to_string()).ok())
            .unwrap_or_default();
        Roots {
            defaults,
            entries: Mutex::new(stored.into_iter().map(Entry::activate).collect()),
        }
    }

    fn write(&self, entries: &[Entry]) {
        let stored: Vec<&Live> = entries.iter().map(|entry| &entry.live).collect();
        let json = NSString::from_str(&serde_json::to_string(&stored).expect("roots json"));
        let object: &AnyObject = &json;
        unsafe {
            self.defaults
                .setObject_forKey(Some(object), &NSString::from_str(KEY));
        }
    }

    pub fn list(&self) -> Vec<Listing> {
        let mut entries = self.entries.lock().unwrap();
        let before: Vec<Live> = entries.iter().map(|entry| entry.live.clone()).collect();
        for entry in entries.iter_mut() {
            let _ = entry.refresh();
        }
        // a renamed folder can refresh onto a path another entry already holds
        let working: HashSet<String> = entries
            .iter()
            .filter(|entry| entry.failure.is_none())
            .map(|entry| entry.live.path.clone())
            .collect();
        let mut seen = HashSet::new();
        entries.retain(|entry| {
            (entry.failure.is_none() || !working.contains(&entry.live.path))
                && seen.insert(entry.live.path.clone())
        });
        if entries.iter().map(|entry| &entry.live).ne(before.iter()) {
            self.write(&entries);
        }
        entries
            .iter()
            .map(|entry| Listing {
                path: entry.live.path.clone(),
                status: match &entry.failure {
                    None => "ok",
                    Some(Failure::Unplugged(_)) => "unplugged",
                    Some(_) => "broken",
                },
            })
            .collect()
    }

    pub fn reopen(&self, path: &str) -> Option<Result<Live, Failure>> {
        let mut entries = self.entries.lock().unwrap();
        let entry = entries.iter_mut().find(|entry| entry.live.path == path)?;
        Some(entry.refresh())
    }

    pub fn adopt(&self, live: Live) {
        let mut entries = self.entries.lock().unwrap();
        entries.retain(|entry| entry.live.path != live.path);
        entries.insert(
            0,
            Entry {
                live,
                failure: None,
            },
        );
        entries.truncate(KEEP);
        self.write(&entries);
    }

    pub fn forget(&self, path: &str) {
        let mut entries = self.entries.lock().unwrap();
        entries.retain(|entry| entry.live.path != path);
        self.write(&entries);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn suite(tag: &str) -> String {
        let suite = format!("net.photopipe.desktop.tests.{tag}");
        NSUserDefaults::standardUserDefaults()
            .removePersistentDomainForName(&NSString::from_str(&suite));
        suite
    }

    fn folder(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("photopipe-roots-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn live(dir: &std::path::Path) -> Live {
        bookmark::activate(&bookmark::mint(dir.to_str().unwrap()).unwrap()).unwrap()
    }

    fn same(a: &str, b: &std::path::Path) -> bool {
        std::fs::canonicalize(a).unwrap() == std::fs::canonicalize(b).unwrap()
    }

    #[test]
    fn adopted_roots_come_back_newest_first_and_forget_sticks() {
        let suite = suite("roundtrip");
        let (old, new) = (folder("old"), folder("new"));
        let roots = Roots::load(Some(&suite));
        roots.adopt(live(&old));
        roots.adopt(live(&new));

        let reloaded = Roots::load(Some(&suite));
        let listed = reloaded.list();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].status, "ok");
        assert!(same(&listed[0].path, &new));
        let reopened = reloaded.reopen(&listed[1].path).unwrap().unwrap();
        reloaded.adopt(reopened);
        assert_eq!(Roots::load(Some(&suite)).list()[0].path, listed[1].path);

        reloaded.forget(&listed[1].path);
        assert_eq!(Roots::load(Some(&suite)).list().len(), 1);
        for dir in [old, new] {
            let _ = std::fs::remove_dir_all(dir);
        }
        NSUserDefaults::standardUserDefaults()
            .removePersistentDomainForName(&NSString::from_str(&suite));
    }

    #[test]
    fn a_gone_folder_is_unplugged_and_kept_until_it_comes_back() {
        let suite = suite("unplugged");
        let dir = folder("gone");
        let roots = Roots::load(Some(&suite));
        roots.adopt(live(&dir));
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(roots.list()[0].status, "unplugged");

        let reloaded = Roots::load(Some(&suite));
        let path = reloaded.list()[0].path.clone();
        assert_eq!(reloaded.list()[0].status, "unplugged");
        assert!(matches!(
            reloaded.reopen(&path),
            Some(Err(Failure::Unplugged(_)))
        ));
        assert!(reloaded.reopen("/never/stored").is_none());

        std::fs::create_dir_all(&dir).unwrap();
        assert!(reloaded.reopen(&path).unwrap().is_ok());
        assert_eq!(reloaded.list()[0].status, "ok");
        let _ = std::fs::remove_dir_all(&dir);
        NSUserDefaults::standardUserDefaults()
            .removePersistentDomainForName(&NSString::from_str(&suite));
    }

    #[test]
    fn a_renamed_folder_follows_its_bookmark_and_collapses_with_its_new_name() {
        let suite = suite("renamed");
        let before = folder("before");
        let after = before.with_file_name("photopipe-roots-after");
        let _ = std::fs::remove_dir_all(&after);
        let roots = Roots::load(Some(&suite));
        roots.adopt(live(&before));
        std::fs::rename(&before, &after).unwrap();
        roots.adopt(live(&after));

        let listed = roots.list();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].status, "ok");
        assert!(same(&listed[0].path, &after));
        let _ = std::fs::remove_dir_all(&after);
        NSUserDefaults::standardUserDefaults()
            .removePersistentDomainForName(&NSString::from_str(&suite));
    }

    #[test]
    fn a_working_root_wins_over_a_dead_one_at_the_same_path_and_a_clean_list_is_not_rewritten() {
        let suite = suite("samepath");
        let dir = folder("samepath");
        let roots = Roots::load(Some(&suite));
        let ok = live(&dir);
        let dead = Live {
            path: ok.path.clone(),
            bookmark: b"garbage".to_vec(),
        };
        *roots.entries.lock().unwrap() = vec![
            Entry {
                live: dead,
                failure: Some(Failure::Broken("stale".into())),
            },
            Entry {
                live: ok,
                failure: None,
            },
        ];
        let listed = roots.list();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].status, "ok");

        let key = NSString::from_str(KEY);
        unsafe {
            roots
                .defaults
                .setObject_forKey(Some(&*NSString::from_str("untouched")), &key);
        }
        roots.list();
        assert_eq!(
            roots.defaults.stringForKey(&key).unwrap().to_string(),
            "untouched"
        );
        let _ = std::fs::remove_dir_all(&dir);
        NSUserDefaults::standardUserDefaults()
            .removePersistentDomainForName(&NSString::from_str(&suite));
    }
}
