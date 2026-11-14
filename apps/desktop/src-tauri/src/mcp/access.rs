use crate::defaults;
use objc2::rc::Retained;
use objc2_foundation::NSUserDefaults;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

const KEY: &str = "agentAccess";

/// Ordered: each level also allows everything below it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum See {
    #[default]
    Off,
    Details,
    Pictures,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Access {
    pub see: See,
}

type Listener = Box<dyn Fn() + Send>;

/// Not the webview's: the relay may start the app and ask before the UI loads.
pub struct AccessStore {
    defaults: Retained<NSUserDefaults>,
    listeners: Mutex<Vec<Listener>>,
}

impl AccessStore {
    pub fn load(suite: Option<&str>) -> Self {
        AccessStore {
            defaults: defaults::open(suite),
            listeners: Mutex::new(Vec::new()),
        }
    }

    /// Read on every ask, so turning access down in a second copy of the app reaches the one serving agents.
    pub fn get(&self) -> Access {
        defaults::read(&self.defaults, KEY).unwrap_or_default()
    }

    pub fn set(&self, access: Access) {
        let listeners = self.listeners.lock().unwrap();
        if self.get() == access {
            return;
        }
        defaults::write(&self.defaults, KEY, &access);
        for listener in listeners.iter() {
            listener();
        }
    }

    #[cfg_attr(not(agents), allow(dead_code))]
    pub fn on_change(&self, listener: impl Fn() + Send + 'static) {
        self.listeners.lock().unwrap().push(Box::new(listener));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defaults::{remove_suite, test_suite};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn access_starts_off_survives_a_relaunch_and_announces_only_real_changes() {
        let suite = test_suite("agent-access");
        let store = AccessStore::load(Some(&suite));
        assert_eq!(store.get().see, See::Off);

        let heard = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&heard);
        store.on_change(move || {
            counter.fetch_add(1, Ordering::SeqCst);
        });
        let pictures = Access { see: See::Pictures };
        store.set(pictures);
        store.set(pictures);
        assert_eq!(heard.load(Ordering::SeqCst), 1);
        assert_eq!(AccessStore::load(Some(&suite)).get(), pictures);

        AccessStore::load(Some(&suite)).set(Access { see: See::Off });
        assert_eq!(
            store.get().see,
            See::Off,
            "a change made elsewhere reaches this store"
        );
        remove_suite(&suite);
    }
}
