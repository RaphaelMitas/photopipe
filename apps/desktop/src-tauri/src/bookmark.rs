//! Security-scoped bookmarks. Under the sandbox a path is not a credential:
//! the folder panel grants access to this process for this session, and the
//! bookmark is the only thing that gets it back next launch.

use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2::AllocAnyThread;
use objc2_foundation::{
    NSCocoaErrorDomain, NSData, NSError, NSFileNoSuchFileError, NSFileReadNoPermissionError,
    NSFileReadNoSuchFileError, NSString, NSURLBookmarkCreationOptions,
    NSURLBookmarkResolutionOptions, NSURL,
};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "lowercase")]
pub enum Failure {
    Unplugged(String),
    Missing(String),
    Denied(String),
    Broken(String),
    Failed(String),
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Failure::Failed(message)
    }
}

fn classify(error: &NSError) -> Failure {
    let message = error.localizedDescription().to_string();
    let cocoa = unsafe { *error.domain() == *NSCocoaErrorDomain };
    let code = error.code();
    if cocoa && (code == NSFileNoSuchFileError || code == NSFileReadNoSuchFileError) {
        Failure::Unplugged(message)
    } else if cocoa && code == NSFileReadNoPermissionError {
        Failure::Denied(message)
    } else {
        Failure::Broken(message)
    }
}

fn mint_url(url: &NSURL) -> Result<Vec<u8>, Failure> {
    url.bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
        NSURLBookmarkCreationOptions::WithSecurityScope,
        None,
        None,
    )
    .map(|data| data.to_vec())
    .map_err(|error| classify(&error))
}

/// Without a bookmark, NoSuchFile is a typo or a deleted folder, not an unplugged drive.
pub fn mint(path: &str) -> Result<Vec<u8>, Failure> {
    mint_url(&NSURL::fileURLWithPath(&NSString::from_str(path))).map_err(|failure| match failure {
        Failure::Unplugged(_) => Failure::Missing(format!("no folder at {path}")),
        other => other,
    })
}

/// A folder this process can read and write until it exits. The scope is
/// never stopped: stopping it would also pull it from under the core.
pub struct Live {
    #[allow(dead_code)]
    url: Retained<NSURL>,
    pub path: String,
    pub bookmark: Vec<u8>,
}

pub fn activate(bookmark: &[u8]) -> Result<Live, Failure> {
    let data = NSData::with_bytes(bookmark);
    let mut stale = Bool::NO;
    let url = unsafe {
        NSURL::initByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
            NSURL::alloc(),
            &data,
            NSURLBookmarkResolutionOptions::WithSecurityScope
                | NSURLBookmarkResolutionOptions::WithoutUI
                | NSURLBookmarkResolutionOptions::WithoutMounting,
            None,
            &mut stale,
        )
    }
    .map_err(|error| classify(&error))?;
    let path = url
        .path()
        .map(|path| path.to_string())
        .ok_or_else(|| Failure::Broken("bookmark resolved to no path".into()))?;
    if !unsafe { url.startAccessingSecurityScopedResource() } {
        return Err(Failure::Denied(format!("macOS refused access to {path}")));
    }
    let bookmark = if stale.as_bool() {
        mint_url(&url).unwrap_or_else(|_| bookmark.to_vec())
    } else {
        bookmark.to_vec()
    };
    Ok(Live {
        url,
        path,
        bookmark,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mint_then_activate_round_trips() {
        let dir = std::env::temp_dir().join(format!("photopipe-bookmark-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let live = activate(&mint(dir.to_str().unwrap()).unwrap()).unwrap();
        assert_eq!(
            std::fs::canonicalize(&live.path).unwrap(),
            std::fs::canonicalize(&dir).unwrap()
        );
        assert!(!live.bookmark.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn gone_target_is_unplugged_bare_path_is_missing_and_garbage_is_broken() {
        let dir =
            std::env::temp_dir().join(format!("photopipe-bookmark-gone-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bookmark = mint(dir.to_str().unwrap()).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(matches!(activate(&bookmark), Err(Failure::Unplugged(_))));
        assert!(matches!(
            mint("/nonexistent/photopipe"),
            Err(Failure::Missing(_))
        ));
        assert!(matches!(
            activate(b"not a bookmark"),
            Err(Failure::Broken(_))
        ));
    }
}
