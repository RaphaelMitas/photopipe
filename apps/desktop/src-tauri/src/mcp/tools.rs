use super::access::{Access, AccessStore, See};
use crate::swift_core;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::time::{Duration, Instant};

type Content = Vec<Value>;

struct Tool {
    name: &'static str,
    see: See,
    description: &'static str,
    input: fn() -> Value,
    run: fn(&Value) -> Result<Content, String>,
}

/// Raw JPEG bytes; a third larger as base64, still under Claude Desktop's 1 MB reply cap.
const LOOK_BUDGET: usize = 600_000;

/// The look lane runs newest first, so a queued look would time out.
static LOOKING: std::sync::Mutex<()> = std::sync::Mutex::new(());
const PAGE: usize = 200;

fn catalog() -> [Tool; 4] {
    [
        Tool {
            name: "list_shoots",
            see: See::Details,
            description: "The projects (shoots) in the library open in Photopipe, with their day, photo count and notes.",
            input: || json!({ "type": "object", "properties": {} }),
            run: list_shoots,
        },
        Tool {
            name: "list_photos",
            see: See::Details,
            description: "Photos in one shoot in capture order, a page at a time. Each row has the photo's id (use it in every other tool), capture time, star rating 0 to 5, flag, whether it is edited, Photopipe's Instinct score (-1 to 1, Apple's aesthetics model; measured at chance at picking the photographer's keepers, so treat it as weak) and the id of the first photo of its stack of near-identical frames.",
            input: || {
                json!({
                    "type": "object",
                    "properties": {
                        "shoot": { "type": "string", "description": "Name from list_shoots." },
                        "min_rating": { "type": "integer", "minimum": 0, "maximum": 5 },
                        "flag": { "type": "string", "enum": ["picked", "rejected", "unflagged"] },
                        "edited": { "type": "boolean" },
                        "offset": { "type": "integer", "minimum": 0 },
                        "limit": { "type": "integer", "minimum": 1, "maximum": 1000, "description": "Default 200." }
                    },
                    "required": ["shoot"]
                })
            },
            run: list_photos,
        },
        Tool {
            name: "get_photo",
            see: See::Details,
            description: "Everything Photopipe knows about one photo: capture time, rating, flag, camera, lens and exposure, size, its edit and the other frames in its stack.",
            input: || {
                json!({
                    "type": "object",
                    "properties": { "photo": { "type": "string", "description": "Photo id from list_photos." } },
                    "required": ["photo"]
                })
            },
            run: get_photo,
        },
        Tool {
            name: "look",
            see: See::Pictures,
            description: "See photos, rendered on this Mac. Measured on real event shoots: picking the better frame of a burst works best from two whole frames at 1024 px side by side, less well from a 2x2 sheet; focus and noise do not show at that size or on any sheet, so judge them from region \"crop\" (100% pixels) at a face. Bigger sheets number every cell; use them to survey, not to judge.",
            input: || {
                json!({
                    "type": "object",
                    "properties": {
                        "photos": { "type": "array", "items": { "type": "string" }, "minItems": 1, "description": "Photo ids. At most 8 separate, 64 on a sheet." },
                        "version": { "type": "string", "enum": ["edited", "unedited", "raw"], "description": "edited (default) applies the photo's crop and adjustments; raw returns the original file's path instead of pixels." },
                        "region": { "type": "string", "enum": ["frame", "crop"], "description": "frame (default) is the whole picture; crop is native pixels around `at`." },
                        "at": {
                            "type": "object",
                            "properties": { "x": { "type": "number", "minimum": 0, "maximum": 1 }, "y": { "type": "number", "minimum": 0, "maximum": 1 } },
                            "required": ["x", "y"],
                            "description": "Center of the crop as a fraction of the framed picture from the top left. Default the middle."
                        },
                        "layout": { "type": "string", "enum": ["separate", "sheet"], "description": "separate (default) is one image per photo; sheet puts them all on one numbered canvas." },
                        "size": { "type": "integer", "minimum": 256, "maximum": 2576, "description": "Long edge in pixels of each image, or of the whole sheet. Default 1024, 1568 for a sheet." }
                    },
                    "required": ["photos"]
                })
            },
            run: look,
        },
    ]
}

pub fn instructions(access: Access) -> String {
    if access.see == See::Off {
        return "Photopipe has agent access turned off. The user can turn it on in Photopipe > Settings > Agents, then reconnect.".into();
    }
    "Photopipe is a photo culling and editing app on this Mac. Photo ids look like \"<shoot>/<file>\": get them from list_photos, then pass them to the other tools.".into()
}

pub fn list(access: Access) -> Vec<Value> {
    catalog()
        .iter()
        .filter(|tool| tool.see <= access.see)
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "inputSchema": (tool.input)(),
                "annotations": { "readOnlyHint": true, "openWorldHint": false },
            })
        })
        .collect()
}

pub fn call(params: &Value, store: &AccessStore) -> Result<Value, (i64, String)> {
    let name = params["name"].as_str().unwrap_or_default();
    let tool = catalog()
        .into_iter()
        .find(|tool| tool.name == name)
        .ok_or((-32602, format!("unknown tool {name}")))?;
    let empty = Value::Object(Map::new());
    let arguments = params.get("arguments").unwrap_or(&empty);
    let refused = || {
        format!(
            "{name} needs Photopipe > Settings > Agents set to let agents see {}.",
            match tool.see {
                See::Pictures => "pictures",
                _ => "details",
            }
        )
    };
    let allowed = || {
        if tool.see > store.get().see {
            Err(refused())
        } else {
            Ok(())
        }
    };
    let outcome = allowed()
        .and_then(|()| ready())
        .and_then(|()| (tool.run)(arguments))
        // asked again after the work: the user may have turned access down while a look ran
        .and_then(|content| allowed().map(|()| content));
    Ok(match outcome {
        Ok(content) => json!({ "content": content, "isError": false }),
        Err(message) => json!({ "content": [text(message)], "isError": true }),
    })
}

fn text(text: impl Into<String>) -> Value {
    json!({ "type": "text", "text": text.into() })
}

fn json_text(value: &Value) -> Value {
    text(value.to_string())
}

fn core(method: &str, params: Value) -> Result<Value, String> {
    swift_core::request(method, Some(params))
}

/// The relay may have just started the app, which opens its folder a moment later.
fn ready() -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if !swift_core::request("status", None)?["root"].is_null() {
            return Ok(());
        }
        if Instant::now() > deadline {
            return Err("Photopipe has no folder open. Ask the user to open one.".into());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn parse<T: DeserializeOwned>(args: &Value) -> Result<T, String> {
    T::deserialize(args).map_err(|e| format!("invalid arguments: {e}"))
}

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Flag {
    Picked,
    Rejected,
    Unflagged,
}

impl Flag {
    fn of(image: &Value) -> Flag {
        match image["flag"].as_i64() {
            Some(1) => Flag::Picked,
            Some(-1) => Flag::Rejected,
            _ => Flag::Unflagged,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ListPhotos {
    shoot: String,
    min_rating: Option<i64>,
    flag: Option<Flag>,
    edited: Option<bool>,
    #[serde(default)]
    offset: usize,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GetPhoto {
    photo: String,
}

#[derive(Default, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Version {
    #[default]
    Edited,
    Unedited,
    Raw,
}

#[derive(Default, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Region {
    #[default]
    Frame,
    Crop,
}

#[derive(Default, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Layout {
    #[default]
    Separate,
    Sheet,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Spot {
    x: f64,
    y: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Look {
    photos: Vec<String>,
    #[serde(default)]
    version: Version,
    #[serde(default)]
    region: Region,
    at: Option<Spot>,
    #[serde(default)]
    layout: Layout,
    size: Option<u32>,
}

fn shoots() -> Result<Vec<Value>, String> {
    Ok(core("listShoots", json!({}))?["shoots"]
        .as_array()
        .cloned()
        .unwrap_or_default())
}

fn images(shoot: &str) -> Result<Vec<Value>, String> {
    let mut images = core("listImages", json!({ "shoot": shoot }))?["images"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    // undated last; file name breaks ties like a camera's numbering
    images.sort_by(|a, b| {
        let key = |image: &Value| {
            (
                image["captured"].as_f64().is_none(),
                image["captured"].as_f64().unwrap_or(0.0),
            )
        };
        key(a)
            .partial_cmp(&key(b))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a["rel"].as_str().cmp(&b["rel"].as_str()))
    });
    Ok(images)
}

fn split_id(id: &str) -> Result<(&str, &str), String> {
    id.split_once('/')
        .filter(|(shoot, rel)| !shoot.is_empty() && !rel.is_empty())
        .ok_or_else(|| format!("{id} is not a photo id; ids look like \"<shoot>/<file>\""))
}

fn paths_of(ids: &[String]) -> Result<Vec<String>, String> {
    let shoots = shoots()?;
    ids.iter()
        .map(|id| {
            let (shoot, rel) = split_id(id)?;
            let dir = shoots
                .iter()
                .find(|s| s["name"] == shoot)
                .and_then(|s| s["path"].as_str())
                .ok_or_else(|| format!("no shoot named {shoot}"))?;
            Ok(format!("{dir}/{rel}"))
        })
        .collect()
}

fn id_of(shoot: &str, image: &Value) -> String {
    format!("{shoot}/{}", image["rel"].as_str().unwrap_or_default())
}

/// Seconds read off the camera clock as if it were UTC, so no zone is claimed.
fn clock(seconds: f64) -> String {
    let secs = seconds.floor() as i64;
    let (days, rest) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Howard Hinnant's civil_from_days
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02}",
        rest / 3600,
        rest / 60 % 60,
        rest % 60
    )
}

fn stack_sizes(images: &[Value]) -> std::collections::HashMap<&str, usize> {
    let mut sizes = std::collections::HashMap::new();
    for stack in images.iter().filter_map(|image| image["stack"].as_str()) {
        *sizes.entry(stack).or_insert(0) += 1;
    }
    sizes
}

fn row(shoot: &str, image: &Value, stack: Option<String>) -> Value {
    let mut row = Map::new();
    row.insert("id".into(), id_of(shoot, image).into());
    if let Some(captured) = image["captured"].as_f64() {
        row.insert("time".into(), clock(captured).into());
    }
    if image["enriched"] == false {
        row.insert("indexing".into(), true.into());
    } else {
        row.insert("rating".into(), image["rating"].clone());
        let flag = Flag::of(image);
        if flag != Flag::Unflagged {
            row.insert("flag".into(), json!(flag));
        }
        if image["edited"] == true {
            row.insert("edited".into(), true.into());
        }
    }
    if let Some(score) = image["score"].as_f64() {
        row.insert("instinct".into(), ((score * 100.0).round() / 100.0).into());
    }
    if let Some(head) = stack {
        row.insert("stack".into(), head.into());
    }
    Value::Object(row)
}

fn list_shoots(_: &Value) -> Result<Content, String> {
    let rows: Vec<Value> = shoots()?
        .iter()
        .map(|shoot| {
            let mut row = Map::new();
            row.insert("name".into(), shoot["name"].clone());
            if !shoot["day"].is_null() {
                row.insert("day".into(), shoot["day"].clone());
            }
            row.insert("photos".into(), shoot["imageCount"].clone());
            if shoot["notes"]
                .as_str()
                .is_some_and(|notes| !notes.is_empty())
            {
                row.insert("notes".into(), shoot["notes"].clone());
            }
            Value::Object(row)
        })
        .collect();
    Ok(vec![json_text(&json!({ "shoots": rows }))])
}

fn list_photos(args: &Value) -> Result<Content, String> {
    let args: ListPhotos = parse(args)?;
    let shoot = args.shoot.as_str();
    let images = images(shoot)?;
    let sizes = stack_sizes(&images);
    let ids: std::collections::HashMap<&str, String> = images
        .iter()
        .filter_map(|image| Some((image["path"].as_str()?, id_of(shoot, image))))
        .collect();
    let matching: Vec<&Value> = images
        .iter()
        .filter(|image| {
            args.min_rating
                .is_none_or(|min| image["rating"].as_i64().unwrap_or(0) >= min)
        })
        .filter(|image| args.flag.is_none_or(|flag| Flag::of(image) == flag))
        .filter(|image| {
            args.edited
                .is_none_or(|edited| image["edited"].as_bool() == Some(edited))
        })
        .collect();
    let offset = args.offset;
    let limit = args.limit.map_or(PAGE, |limit| limit.clamp(1, 1000));
    let page: Vec<Value> = matching
        .iter()
        .skip(offset)
        .take(limit)
        .map(|image| {
            // a stack of one is not worth a field
            let stack = image["stack"]
                .as_str()
                .filter(|stack| sizes[stack] > 1)
                .and_then(|stack| ids.get(stack).cloned());
            row(shoot, image, stack)
        })
        .collect();
    let mut answer =
        json!({ "shoot": shoot, "total": matching.len(), "offset": offset, "photos": page });
    let next = offset.saturating_add(limit);
    if next < matching.len() {
        answer["next_offset"] = next.into();
    }
    let indexing = images
        .iter()
        .filter(|image| image["enriched"] == false)
        .count();
    if indexing > 0 {
        answer["note"] = format!("{indexing} photos are still being indexed: their ratings and flags are not read yet, so filters count them as unrated, and their order can still change between pages").into();
    }
    Ok(vec![json_text(&answer)])
}

fn get_photo(args: &Value) -> Result<Content, String> {
    let args: GetPhoto = parse(args)?;
    let id = args.photo.as_str();
    let (shoot, rel) = split_id(id)?;
    let images = images(shoot)?;
    let image = images
        .iter()
        .find(|image| image["rel"] == rel)
        .ok_or_else(|| format!("no photo {id}"))?;
    let mut answer = row(shoot, image, None);
    if image["enriched"] == true {
        answer["width"] = image["width"].clone();
        answer["height"] = image["height"].clone();
        answer["camera"] = image["exif"].clone();
    }
    if image["edited"] == true {
        answer["edit"] = image["edit"].clone();
    }
    if let Some(stack) = image["stack"].as_str() {
        let frames: Vec<String> = images
            .iter()
            .filter(|other| other["stack"] == stack)
            .map(|other| id_of(shoot, other))
            .collect();
        if frames.len() > 1 {
            answer["stack"] = frames.into();
        }
    }
    Ok(vec![json_text(&answer)])
}

fn look(args: &Value) -> Result<Content, String> {
    let args: Look = parse(args)?;
    let ids = &args.photos;
    if ids.is_empty() {
        return Err("photos is required".into());
    }
    let paths = paths_of(ids)?;
    if args.version == Version::Raw {
        let originals = core("originals", json!({ "paths": paths }))?;
        let files: Vec<Value> = ids
            .iter()
            .zip(originals["files"].as_array().into_iter().flatten())
            .map(|(id, original)| {
                json!({ "id": id, "file": original["path"], "sidecar": original["sidecar"] })
            })
            .collect();
        return Ok(vec![json_text(&json!({ "files": files }))]);
    }
    let sheet = args.layout == Layout::Sheet;
    let mut params = json!({
        "paths": paths,
        "edited": args.version == Version::Edited,
        "sheet": sheet,
        "longEdge": args.size.unwrap_or(if sheet { 1568 } else { 1024 }),
        "maxBytes": LOOK_BUDGET,
    });
    match (args.region, args.at) {
        (Region::Crop, at) => {
            let at = at.unwrap_or(Spot { x: 0.5, y: 0.5 });
            params["x"] = at.x.into();
            params["y"] = at.y.into();
        }
        (Region::Frame, Some(_)) => return Err("at only applies to region \"crop\"".into()),
        (Region::Frame, None) => {}
    }
    let shown = {
        let _turn = LOOKING
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        core("look", params)?
    };
    let mut content = Vec::new();
    let mut spent = 0;
    let mut left_out = Vec::new();
    for (index, image) in shown["images"].as_array().into_iter().flatten().enumerate() {
        let jpeg = image["jpeg"].as_str().unwrap_or_default();
        let photos = if sheet {
            ids.clone()
        } else {
            vec![ids[index].clone()]
        };
        // the first image always goes out, or a single oversized sheet would show nothing at all
        if !content.is_empty() && spent + jpeg.len() > LOOK_BUDGET * 4 / 3 {
            left_out.extend(photos);
            continue;
        }
        spent += jpeg.len();
        content.push(text(if sheet {
            let cells: Vec<String> = photos
                .iter()
                .enumerate()
                .map(|(i, id)| format!("{} = {id}", i + 1))
                .collect();
            format!(
                "Sheet, cells numbered left to right, top to bottom: {}",
                cells.join(", ")
            )
        } else {
            photos.join(", ")
        }));
        content.push(json!({ "type": "image", "data": jpeg, "mimeType": "image/jpeg" }));
    }
    if !left_out.is_empty() {
        content.push(text(format!(
            "Left out to stay under the reply size limit, ask for them in another look: {}",
            left_out.join(", ")
        )));
    }
    Ok(content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_camera_clock_reads_back_as_written() {
        assert_eq!(clock(0.0), "1970-01-01 00:00:00");
        assert_eq!(clock(1_786_219_265.4), "2026-08-08 20:01:05");
        assert_eq!(clock(951_782_400.0), "2000-02-29 00:00:00");
    }

    #[test]
    fn look_arguments_left_out_take_their_default_and_wrong_ones_are_refused() {
        let look: Look = parse(&json!({ "photos": ["S/a.jpg"] })).unwrap();
        assert!(look.version == Version::Edited && look.region == Region::Frame);
        assert!(parse::<Look>(&json!({ "photos": [], "version": "original" })).is_err());
        assert!(parse::<Look>(&json!({ "photos": [], "at": { "x": 0.2 } })).is_err());
        assert!(parse::<Look>(&json!({ "photos": [], "size": "2000" })).is_err());
        assert!(parse::<Look>(&json!({ "photos": [], "verison": "unedited" })).is_err());
    }

    #[test]
    fn an_id_needs_a_shoot_and_a_file() {
        assert_eq!(
            split_id("Tanzabend/sel/DSC1.ARW"),
            Ok(("Tanzabend", "sel/DSC1.ARW"))
        );
        assert!(split_id("DSC1.ARW").is_err());
        assert!(split_id("/DSC1.ARW").is_err());
    }

    #[test]
    fn a_row_says_only_what_differs_from_the_default() {
        let image = json!({
            "path": "/r/S/a.jpg", "rel": "a.jpg", "rating": 3, "flag": 0, "edited": false,
            "enriched": true, "captured": null, "score": 0.4321, "stack": "/r/S/a.jpg"
        });
        assert_eq!(
            row("S", &image, None),
            json!({ "id": "S/a.jpg", "rating": 3, "instinct": 0.43 })
        );
        let pending =
            json!({ "path": "/r/S/b.jpg", "rel": "b.jpg", "rating": 0, "enriched": false });
        assert_eq!(
            row("S", &pending, None),
            json!({ "id": "S/b.jpg", "indexing": true })
        );
    }
}
