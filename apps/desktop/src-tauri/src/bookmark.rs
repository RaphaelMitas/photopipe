//! Security-scoped bookmarks. Under the sandbox a path is not a credential:
//! the folder panel grants access to this process for this session, and the
//! bookmark is the only thing that gets it back next launch.

use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2::AllocAnyThread;
use objc2_foundation::{
    NSCocoaErrorDomain, NSData, NSError, NSFileNoSuchFileError, NSFileReadNoPermissionError,
    NSFileReadNoSuchFileError, NSString, NSURL, NSURLBookmarkCreationOptions,
    NSURLBookmarkResolutionOptions,
};

#[derive(Debug)]
pub enum Failure {
    Unplugged(String),
    Denied(String),
    Broken(String),
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

pub fn mint(path: &str) -> Result<Vec<u8>, Failure> {
    mint_url(&NSURL::fileURLWithPath(&NSString::from_str(path)))
}

pub struct Resolved {
    url: Retained<NSURL>,
    pub path: String,
    pub stale: bool,
}

pub fn resolve(bookmark: &[u8]) -> Result<Resolved, Failure> {
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
    Ok(Resolved {
        url,
        path,
        stale: stale.as_bool(),
    })
}

impl Resolved {
    pub fn start_access(self) -> Result<Access, Failure> {
        if unsafe { self.url.startAccessingSecurityScopedResource() } {
            Ok(Access(self.url))
        } else {
            Err(Failure::Denied(format!("macOS refused access to {}", self.path)))
        }
    }
}

pub struct Access(Retained<NSURL>);

impl Access {
    pub fn mint(&self) -> Result<Vec<u8>, Failure> {
        mint_url(&self.0)
    }
}

impl Drop for Access {
    fn drop(&mut self) {
        unsafe { self.0.stopAccessingSecurityScopedResource() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mint_resolve_and_start_access_round_trip() {
        let dir = std::env::temp_dir().join(format!("photopipe-bookmark-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bookmark = mint(dir.to_str().unwrap()).unwrap();
        let resolved = resolve(&bookmark).unwrap();
        assert!(!resolved.stale);
        assert_eq!(
            std::fs::canonicalize(&resolved.path).unwrap(),
            std::fs::canonicalize(&dir).unwrap()
        );
        let access = resolved.start_access().unwrap();
        assert!(!access.mint().unwrap().is_empty());
        drop(access);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_target_is_unplugged_and_garbage_is_broken() {
        let dir = std::env::temp_dir().join(format!("photopipe-bookmark-gone-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bookmark = mint(dir.to_str().unwrap()).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(matches!(resolve(&bookmark), Err(Failure::Unplugged(_))));
        assert!(matches!(mint("/nonexistent/photopipe"), Err(Failure::Unplugged(_))));
        assert!(matches!(resolve(b"not a bookmark"), Err(Failure::Broken(_))));
    }
}
