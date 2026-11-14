use super::access::{Act, See};
use super::bridge::{Bridge, UNANSWERED};
use super::tools::{core, json_text, parse, Content, Flag, Tool};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Long enough for a call queued behind others in the webview, and for opening a shoot.
const UI_WAIT: Duration = Duration::from_secs(60);
const EXPORT_WAIT: Duration = Duration::from_secs(30 * 60);

/// Tools the webview answers, because the open shoot, selection and history only live there.
pub fn catalog() -> Vec<Tool> {
    vec![
        Tool {
            name: "get_view",
            see: See::Details,
            act: Act::Off,
            description: "What the user is looking at in Photopipe right now: the open shoot, grid or loupe, the photo in the loupe, the selection, the rating filter, the recent history and the keyboard actions that work here.",
            input: || json!({ "type": "object", "properties": {} }),
            run: |args, bridge| forward::<Nothing>("get_view", args, bridge),
        },
        Tool {
            name: "show",
            see: See::Details,
            act: Act::Cull,
            description: "Open a shoot in Photopipe, a photo in the loupe, or select photos in the grid. Changes work on the open shoot, so open it first. Switching shoots clears the app's undo history, as it does when the user switches.",
            input: || {
                json!({
                    "type": "object",
                    "properties": {
                        "shoot": { "type": "string", "description": "Name from list_shoots. Leave out to stay in the open shoot." },
                        "photo": { "type": "string", "description": "Photo id to open in the loupe." },
                        "select": { "type": "array", "items": { "type": "string" }, "description": "Photo ids to select in the grid; an empty list clears the selection." }
                    }
                })
            },
            run: |args, bridge| forward::<Show>("show", args, bridge),
        },
        Tool {
            name: "rate",
            see: See::Details,
            act: Act::Cull,
            description: "Set the star rating of photos in the open shoot. One undoable step in the app.",
            input: || {
                json!({
                    "type": "object",
                    "properties": {
                        "photos": photos_schema(),
                        "rating": { "type": "integer", "minimum": 0, "maximum": 5, "description": "0 clears the rating." }
                    },
                    "required": ["photos", "rating"]
                })
            },
            run: rate,
        },
        Tool {
            name: "flag",
            see: See::Details,
            act: Act::Cull,
            description: "Pick, reject or unflag photos in the open shoot. One undoable step in the app.",
            input: || {
                json!({
                    "type": "object",
                    "properties": {
                        "photos": photos_schema(),
                        "flag": { "type": "string", "enum": ["picked", "rejected", "unflagged"] }
                    },
                    "required": ["photos", "flag"]
                })
            },
            run: |args, bridge| forward::<FlagPhotos>("flag", args, bridge),
        },
        Tool {
            name: "edit",
            see: See::Details,
            act: Act::Cull,
            description: "Set adjustments on photos in the open shoot, keeping the ones not named. One undoable step in the app. If look is available, check the result with it before going on.",
            input: || {
                let slider = json!({ "type": "number", "minimum": -100, "maximum": 100 });
                json!({
                    "type": "object",
                    "properties": {
                        "photos": photos_schema(),
                        "reset": { "type": "boolean", "description": "Start from no edit instead of the photo's current one." },
                        "set": {
                            "type": "object",
                            "properties": {
                                "exposure": { "type": "number", "minimum": -3, "maximum": 3, "description": "Stops." },
                                "temperature": { "type": "number", "description": "Raw files: kelvin, 2000 to 12000. Others: -100 to 100." },
                                "tint": { "type": "number", "description": "Raw files: -150 to 150. Others: -100 to 100." },
                                "highlights": slider, "shadows": slider, "whites": slider, "blacks": slider,
                                "texture": slider, "clarity": slider, "dehaze": slider,
                                "vibrance": slider, "saturation": slider,
                                "denoise": { "type": "number", "minimum": 0, "maximum": 100 },
                                "crop": {
                                    "type": "object",
                                    "properties": { "left": { "type": "number" }, "top": { "type": "number" }, "right": { "type": "number" }, "bottom": { "type": "number" } },
                                    "required": ["left", "top", "right", "bottom"],
                                    "description": "Fractions of the photo from the top left."
                                },
                                "crop_angle": { "type": "number", "minimum": -45, "maximum": 45, "description": "Straightening in degrees." },
                                "rotation": { "type": "integer", "enum": [0, 90, 180, 270] }
                            }
                        }
                    },
                    "required": ["photos", "set"]
                })
            },
            run: |args, bridge| forward::<EditPhotos>("edit", args, bridge),
        },
        Tool {
            name: "undo",
            see: See::Details,
            act: Act::Cull,
            description: "Step back through the app's history, or forward with redo. It walks the same history as the user's own Cmd-Z, so it can undo the user's changes too: check get_view first.",
            input: || {
                json!({
                    "type": "object",
                    "properties": {
                        "steps": { "type": "integer", "minimum": 1, "maximum": 50, "description": "Default 1." },
                        "redo": { "type": "boolean" }
                    }
                })
            },
            run: |args, bridge| forward::<Undo>("undo", args, bridge),
        },
        Tool {
            name: "ui_action",
            see: See::Details,
            act: Act::Cull,
            description: "Run one of the app's keyboard actions as if the user pressed its key, such as photo.next, stack.enter or editPanel.toggle. get_view lists the ones that work in the current view.",
            input: || {
                json!({
                    "type": "object",
                    "properties": { "action": { "type": "string" } },
                    "required": ["action"]
                })
            },
            run: |args, bridge| forward::<UiAction>("ui_action", args, bridge),
        },
        Tool {
            name: "export",
            see: See::Pictures,
            act: Act::Everything,
            description: "Export photos from the open shoot into a folder outside the library, shown in the app's export list, and wait for it to finish. With zip the photos go into a new <shoot>.zip in that folder.",
            input: || {
                json!({
                    "type": "object",
                    "properties": {
                        "photos": photos_schema(),
                        "destination": { "type": "string", "description": "Absolute path of an existing folder outside the library." },
                        "format": { "type": "string", "enum": ["original", "jpeg"], "description": "original (default) copies the files; jpeg renders them with their edits." },
                        "quality": { "type": "integer", "minimum": 1, "maximum": 100, "description": "JPEG only. Default 90." },
                        "long_edge": { "type": "integer", "minimum": 256, "description": "JPEG only. Leave out for full size." },
                        "zip": { "type": "boolean" }
                    },
                    "required": ["photos", "destination"]
                })
            },
            run: export,
        },
        Tool {
            name: "trash",
            see: See::Details,
            act: Act::Everything,
            description: "Move photos of the open shoot and their sidecars to the macOS Trash. Not undoable in the app; the user can put them back from the Trash.",
            input: || {
                json!({
                    "type": "object",
                    "properties": { "photos": photos_schema() },
                    "required": ["photos"]
                })
            },
            run: |args, bridge| forward::<Photos>("trash", args, bridge),
        },
    ]
}

fn photos_schema() -> Value {
    json!({ "type": "array", "items": { "type": "string" }, "minItems": 1, "description": "Photo ids in the open shoot." })
}

fn forward<T: DeserializeOwned + Serialize>(
    tool: &str,
    args: &Value,
    bridge: &Bridge,
) -> Result<Content, String> {
    let args: T = parse(args)?;
    let args = serde_json::to_value(args).map_err(|e| e.to_string())?;
    Ok(vec![json_text(&bridge.ask(tool, &args, UI_WAIT)?)])
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Nothing {}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Show {
    shoot: Option<String>,
    photo: Option<String>,
    select: Option<Vec<String>>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Photos {
    photos: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RatePhotos {
    photos: Vec<String>,
    rating: u8,
}

fn rate(args: &Value, bridge: &Bridge) -> Result<Content, String> {
    let rate: RatePhotos = parse(args)?;
    if rate.rating > 5 {
        return Err("rating goes from 0 to 5".into());
    }
    forward::<RatePhotos>("rate", args, bridge)
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct FlagPhotos {
    photos: Vec<String>,
    flag: Flag,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Adjust {
    #[serde(skip_serializing_if = "Option::is_none")]
    exposure: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tint: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    highlights: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    shadows: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    whites: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    blacks: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    texture: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    clarity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dehaze: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    vibrance: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    saturation: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    denoise: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    crop: Option<Crop>,
    #[serde(
        rename(deserialize = "crop_angle", serialize = "cropAngle"),
        skip_serializing_if = "Option::is_none"
    )]
    crop_angle: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rotation: Option<u16>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Crop {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct EditPhotos {
    photos: Vec<String>,
    set: Adjust,
    #[serde(default)]
    reset: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Undo {
    #[serde(default = "one")]
    steps: u8,
    #[serde(default)]
    redo: bool,
}

fn one() -> u8 {
    1
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct UiAction {
    action: String,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Format {
    #[default]
    Original,
    Jpeg,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Export {
    photos: Vec<String>,
    destination: String,
    #[serde(default)]
    format: Format,
    #[serde(skip_serializing_if = "Option::is_none")]
    quality: Option<u8>,
    #[serde(
        rename(deserialize = "long_edge", serialize = "longEdge"),
        skip_serializing_if = "Option::is_none"
    )]
    long_edge: Option<u32>,
    #[serde(default)]
    zip: bool,
}

/// The webview starts the job so it shows in the app's export list; progress is polled from the core.
fn export(args: &Value, bridge: &Bridge) -> Result<Content, String> {
    let mut export: Export = parse(args)?;
    let shoot = export
        .photos
        .first()
        .and_then(|id| id.split_once('/'))
        .map_or("photos", |(shoot, _)| shoot);
    let mut reserved = Reserved(None);
    export.destination = destination(&export.destination, shoot, export.zip, &mut reserved)?;
    let args = serde_json::to_value(export).map_err(|e| e.to_string())?;
    let started = bridge.ask("export", &args, UI_WAIT).inspect_err(|error| {
        // the job may have started and will write the archive onto the reservation
        if error == UNANSWERED {
            reserved.0 = None;
        }
    })?;
    let id = started["id"].as_str().ok_or("the export did not start")?;
    let deadline = Instant::now() + EXPORT_WAIT;
    loop {
        let progress =
            core("exportStatus", json!({ "id": id })).inspect_err(|_| reserved.0 = None)?;
        if progress["running"] == false {
            return Ok(vec![json_text(&json!({
                "exported": progress["done"],
                "failed": progress["failed"],
                "failures": progress["failures"],
                "cancelled": progress["cancelled"],
                "error": progress["error"],
            }))]);
        }
        if Instant::now() > deadline {
            // still running: the archive lands on the reservation later
            reserved.0 = None;
            return Ok(vec![json_text(
                &json!({ "running": true, "done": progress["done"], "total": progress["total"] }),
            )]);
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

/// The core writes a zip to exactly the path it is given, replacing whatever is there; an agent only ever gets a new file.
fn destination(
    folder: &str,
    shoot: &str,
    zip: bool,
    reserved: &mut Reserved,
) -> Result<String, String> {
    let folder = Path::new(folder);
    if !folder.is_absolute() || !folder.is_dir() {
        return Err(format!("{} is not an existing folder", folder.display()));
    }
    let root = core("status", json!({}))?["root"]
        .as_str()
        .map(PathBuf::from)
        .ok_or("Photopipe has no folder open")?;
    if inside(folder, &root) {
        return Err("Export into a folder outside the library; inside it the copies would show up as new photos.".into());
    }
    if !zip {
        return Ok(folder.to_string_lossy().into_owned());
    }
    let path = reserve_zip(folder, shoot).map_err(|e| e.to_string())?;
    let destination = path.to_string_lossy().into_owned();
    reserved.0 = Some(path);
    Ok(destination)
}

/// By file identity, not path: a firmlink like /System/Volumes/Data names the library under another path.
fn inside(folder: &Path, root: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    let Ok(root) = std::fs::metadata(root) else {
        return false;
    };
    let folder = folder
        .canonicalize()
        .unwrap_or_else(|_| folder.to_path_buf());
    folder.ancestors().any(|dir| {
        std::fs::metadata(dir).is_ok_and(|dir| dir.dev() == root.dev() && dir.ino() == root.ino())
    })
}

/// Claimed on disk at once, so a second export picking a name right after, even one still running, sees it taken.
fn reserve_zip(folder: &Path, shoot: &str) -> std::io::Result<PathBuf> {
    for n in 1.. {
        let path = match n {
            1 => folder.join(format!("{shoot}.zip")),
            n => folder.join(format!("{shoot} {n}.zip")),
        };
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(_) => return Ok(path),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    unreachable!("some name is free")
}

/// The empty placeholder goes again if the export never wrote over it.
struct Reserved(Option<PathBuf>);

impl Drop for Reserved {
    fn drop(&mut self) {
        if let Some(path) = &self.0 {
            if std::fs::metadata(path).is_ok_and(|placeholder| placeholder.len() == 0) {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits_reach_the_webview_under_its_own_field_names() {
        let edit: EditPhotos = parse(&json!({
            "photos": ["S/a.ARW"], "set": { "exposure": 0.5, "crop_angle": 2.0 }
        }))
        .unwrap();
        assert_eq!(
            serde_json::to_value(edit).unwrap(),
            json!({ "photos": ["S/a.ARW"], "set": { "exposure": 0.5, "cropAngle": 2.0 }, "reset": false })
        );
        assert!(parse::<EditPhotos>(&json!({ "photos": [], "set": { "contrast": 10 } })).is_err());
    }

    #[test]
    fn a_zip_never_lands_on_something_that_is_already_there() {
        let folder = std::env::temp_dir().join(format!("pp-zip-{}", std::process::id()));
        std::fs::create_dir_all(folder.join("Shoot.zip")).unwrap();
        std::fs::write(folder.join("Shoot 2.zip"), b"older export").unwrap();
        let first = Reserved(Some(reserve_zip(&folder, "Shoot").unwrap()));
        let second = reserve_zip(&folder, "Shoot").unwrap();
        assert_eq!(
            first.0.as_deref(),
            Some(folder.join("Shoot 3.zip").as_path())
        );
        assert_eq!(second, folder.join("Shoot 4.zip"));
        drop(first);
        assert!(
            !folder.join("Shoot 3.zip").exists(),
            "an unused reservation is given back"
        );
        assert!(destination("relative/folder", "Shoot", true, &mut Reserved(None)).is_err());
        assert!(inside(&folder.join("Shoot.zip"), &folder));
        assert!(!inside(&folder, &folder.join("Shoot.zip")));
        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn a_rating_past_five_is_refused_before_the_window_is_asked() {
        let bridge = Bridge::new(|_| panic!("the window must not be asked"));
        assert!(rate(&json!({ "photos": ["S/a.ARW"], "rating": 6 }), &bridge).is_err());
    }
}
