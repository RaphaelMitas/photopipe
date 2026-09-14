use crate::bookmark::{self, Failure, Live};
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::AllocAnyThread;
use objc2_foundation::{NSString, NSUserDefaults};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

const KEY: &str = "roots";
const KEEP: usize = 5;

#[derive(Serialize, Deserialize)]
struct Stored {
    path: String,
    bookmark: Vec<u8>,
}

struct Entry {
    path: String,
    bookmark: Vec<u8>,
    state: Result<Live, Failure>,
}

impl Entry {
    fn from_stored(stored: Stored) -> Self {
        let mut entry = Entry {
            path: stored.path,
            bookmark: stored.bookmark,
            state: Err(Failure::Broken("not activated".into())),
        };
        let _ = entry.activate();
        entry
    }

    fn activate(&mut self) -> Result<String, Failure> {
        match bookmark::activate(&self.bookmark) {
            Ok(live) => {
                self.path = live.path.clone();
                self.bookmark = live.bookmark.clone();
                self.state = Ok(live);
                Ok(self.path.clone())
            }
            Err(failure) => {
                self.state = Err(failure.clone());
                Err(failure)
            }
        }
    }
}

pub struct Listing {
    pub path: String,
    pub status: &'static str,
}

/// The folders this process may enter, newest first, held for its lifetime.
/// cfprefsd owns the file; the shell only ever sees this list.
pub struct Roots {
    suite: Option<String>,
    entries: Mutex<Vec<Entry>>,
}

impl Roots {
    pub fn load(suite: Option<&str>) -> Self {
        let roots = Roots {
            suite: suite.map(str::to_owned),
            entries: Mutex::new(Vec::new()),
        };
        let stored: Vec<Stored> = roots
            .defaults()
            .stringForKey(&NSString::from_str(KEY))
            .and_then(|json| serde_json::from_str(&json.to_string()).ok())
            .unwrap_or_default();
        *roots.entries.lock().unwrap() = stored.into_iter().map(Entry::from_stored).collect();
        roots
    }

    fn defaults(&self) -> Retained<NSUserDefaults> {
        match &self.suite {
            Some(suite) => NSUserDefaults::initWithSuiteName(
                NSUserDefaults::alloc(),
                Some(&NSString::from_str(suite)),
            )
            .expect("suite defaults"),
            None => NSUserDefaults::standardUserDefaults(),
        }
    }

    fn write(&self, entries: &[Entry]) {
        let stored: Vec<Stored> = entries
            .iter()
            .map(|entry| Stored {
                path: entry.path.clone(),
                bookmark: entry.bookmark.clone(),
            })
            .collect();
        let json = NSString::from_str(&serde_json::to_string(&stored).expect("roots json"));
        let object: &AnyObject = &json;
        unsafe {
            self.defaults()
                .setObject_forKey(Some(object), &NSString::from_str(KEY));
        }
    }

    pub fn list(&self) -> Vec<Listing> {
        self.entries
            .lock()
            .unwrap()
            .iter()
            .map(|entry| Listing {
                path: entry.path.clone(),
                status: match &entry.state {
                    Ok(_) => "ok",
                    Err(Failure::Unplugged(_)) => "unplugged",
                    Err(_) => "broken",
                },
            })
            .collect()
    }

    /// The path the folder has now, for a remembered root; unplugged and
    /// broken ones are tried again in case the drive came back.
    pub fn reopen(&self, path: &str) -> Option<Result<String, Failure>> {
        let mut entries = self.entries.lock().unwrap();
        let entry = entries.iter_mut().find(|entry| entry.path == path)?;
        Some(match &entry.state {
            Ok(live) => Ok(live.path.clone()),
            Err(_) => entry.activate(),
        })
    }

    /// Newest first is what the next launch opens.
    pub fn promote(&self, path: &str) {
        let mut entries = self.entries.lock().unwrap();
        if let Some(index) = entries.iter().position(|entry| entry.path == path) {
            let entry = entries.remove(index);
            entries.insert(0, entry);
        }
        self.write(&entries);
    }

    pub fn adopt(&self, live: Live) {
        let mut entries = self.entries.lock().unwrap();
        entries.retain(|entry| entry.path != live.path);
        entries.insert(
            0,
            Entry {
                path: live.path.clone(),
                bookmark: live.bookmark.clone(),
                state: Ok(live),
            },
        );
        entries.truncate(KEEP);
        self.write(&entries);
    }

    pub fn forget(&self, path: &str) {
        let mut entries = self.entries.lock().unwrap();
        entries.retain(|entry| entry.path != path);
        self.write(&entries);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn suite(tag: &str) -> String {
        let suite = format!("net.photopipe.desktop.tests.{tag}.{}", std::process::id());
        NSUserDefaults::standardUserDefaults()
            .removePersistentDomainForName(&NSString::from_str(&suite));
        suite
    }

    fn folder(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("photopipe-roots-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn live(dir: &std::path::Path) -> Live {
        bookmark::activate(&bookmark::mint(dir.to_str().unwrap()).unwrap()).unwrap()
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
        assert_eq!(
            std::fs::canonicalize(&listed[0].path).unwrap(),
            std::fs::canonicalize(&new).unwrap()
        );
        assert!(reloaded.reopen(&listed[1].path).unwrap().is_ok());
        reloaded.promote(&listed[1].path);
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

        let reloaded = Roots::load(Some(&suite));
        let path = reloaded.list()[0].path.clone();
        assert_eq!(reloaded.list()[0].status, "unplugged");
        assert!(matches!(
            reloaded.reopen(&path),
            Some(Err(Failure::Unplugged(_)))
        ));
        assert_eq!(reloaded.list()[0].status, "unplugged");
        assert!(reloaded.reopen("/never/stored").is_none());

        std::fs::create_dir_all(&dir).unwrap();
        assert!(reloaded.reopen(&path).unwrap().is_ok());
        assert_eq!(reloaded.list()[0].status, "ok");
        let _ = std::fs::remove_dir_all(&dir);
        NSUserDefaults::standardUserDefaults()
            .removePersistentDomainForName(&NSString::from_str(&suite));
    }
}
