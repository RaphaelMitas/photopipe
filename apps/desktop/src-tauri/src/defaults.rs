use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::AllocAnyThread;
use objc2_foundation::{NSString, NSUserDefaults};
use serde::{de::DeserializeOwned, Serialize};

/// A suite keeps a test's values out of the app's own.
pub fn open(suite: Option<&str>) -> Retained<NSUserDefaults> {
    match suite {
        Some(suite) => NSUserDefaults::initWithSuiteName(
            NSUserDefaults::alloc(),
            Some(&NSString::from_str(suite)),
        )
        .expect("suite defaults"),
        None => NSUserDefaults::standardUserDefaults(),
    }
}

/// Stored as a JSON string; a value that no longer parses reads as missing.
pub fn read<T: DeserializeOwned>(defaults: &NSUserDefaults, key: &str) -> Option<T> {
    defaults
        .stringForKey(&NSString::from_str(key))
        .and_then(|json| serde_json::from_str(&json.to_string()).ok())
}

pub fn write<T: Serialize>(defaults: &NSUserDefaults, key: &str, value: &T) {
    let json = NSString::from_str(&serde_json::to_string(value).expect("defaults json"));
    let object: &AnyObject = &json;
    unsafe {
        defaults.setObject_forKey(Some(object), &NSString::from_str(key));
    }
}
