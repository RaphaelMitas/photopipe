use super::access::{Access, AccessStore, Act, See};
use super::bridge::Bridge;
use super::ui;
use crate::swift_core;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::time::{Duration, Instant};

pub type Content = Vec<Value>;

pub struct Tool {
    pub name: &'static str,
    pub see: See,
    pub act: Act,
    pub description: &'static str,
    pub input: fn() -> Value,
    pub run: fn(&Value, &Bridge) -> Result<Content, String>,
}

const LOOK_BUDGET: usize = 600_000;

static AGENT_LANE: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn on_agent_lane(method: &str, params: Value) -> Result<Value, String> {
    let _turn = AGENT_LANE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    core(method, params)
}
const PAGE: usize = 200;

fn catalog() -> Vec<Tool> {
    let mut tools = vec![
        Tool {
            name: "list_shoots",
            see: See::Details,
            act: Act::Off,
            description: "The projects (shoots) in the library open in Photopipe, with their day, photo count and notes.",
            input: || json!({ "type": "object", "properties": {} }),
            run: list_shoots,
        },
        Tool {
            name: "list_photos",
            see: See::Details,
            act: Act::Off,
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
            act: Act::Off,
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
            name: "faces",
            see: See::Details,
            act: Act::Off,
            description: "Faces Photopipe finds in photos, read on this Mac: where each face is (fractions of the photo as shot, from the top left), Vision's face capture quality (0 to 1: sharpness, light, expression and pose together) and a sharpness number that only compares between frames of the same scene, higher is sharper. The four biggest faces per photo. Found once and remembered. Photos not done within a minute and a half come back pending; ask again later.",
            input: || {
                json!({
                    "type": "object",
                    "properties": { "photos": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 64 } },
                    "required": ["photos"]
                })
            },
            run: faces,
        },
        Tool {
            name: "describe",
            see: See::Descriptions,
            act: Act::Off,
            description: "A short description of each photo by Apple's on-device model, written on this Mac without sending pixels anywhere: who is in it and what they do, expressions and eyes, composition, and visible flaws. Needs macOS 27 with Apple Intelligence on; a few seconds a photo.",
            input: || {
                json!({
                    "type": "object",
                    "properties": { "photos": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 8 } },
                    "required": ["photos"]
                })
            },
            run: describe,
        },
        Tool {
            name: "look",
            see: See::Pictures,
            act: Act::Off,
            description: "See photos, rendered on this Mac. Measured on real event shoots: picking the better frame of a burst works best from two whole frames at 1024 px side by side, less well from a 2x2 sheet; focus and noise do not show at that size or on any sheet, so judge them from region \"crop\" (100% pixels) at a face. Bigger sheets number every cell; use them to survey, not to judge.",
            input: || {
                json!({
                    "type": "object",
                    "properties": {
                        "photos": { "type": "array", "items": { "type": "string" }, "minItems": 1, "description": "Photo ids. At most 8 separate, 64 on a sheet." },
                        "version": { "type": "string", "enum": ["edited", "unedited", "raw"], "description": "edited (default) applies the photo's crop and adjustments; raw returns the original file's path instead of pixels." },
                        "region": { "type": "string", "enum": ["frame", "crop", "faces"], "description": "frame (default) is the whole picture; crop is native pixels around `at`; faces is one sheet of every face found, at up to native pixels and unedited: the way to judge focus and eyes across a burst." },
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
    ];
    tools.extend(ui::catalog());
    tools
}

pub fn instructions(access: Access) -> String {
    if access.see == See::Off {
        return "Photopipe has agent access turned off. The user can turn it on in Photopipe > Settings > Agents, then reconnect.".into();
    }
    let mut text = "Photopipe is a photo culling and editing app on this Mac. Photo ids look like \"<shoot>/<file>\": get them from list_photos, then pass them to the other tools.".to_owned();
    if access.act > Act::Off {
        text.push_str(" Changes go through the app the user is looking at: open a shoot with show before rating, flagging or editing in it. Ratings, flags and edits are each one step in the app's history, so the user can undo them.");
    }
    if access.act == Act::Everything {
        text.push_str(" Exports and trash are not undoable in the app.");
    }
    text
}

pub fn list(access: Access) -> Vec<Value> {
    catalog()
        .iter()
        .filter(|tool| tool.see <= access.see && tool.act <= access.act)
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "inputSchema": (tool.input)(),
                "annotations": {
                    "readOnlyHint": tool.act == Act::Off,
                    "destructiveHint": tool.act == Act::Everything,
                    "openWorldHint": false,
                },
            })
        })
        .collect()
}

pub fn call(params: &Value, store: &AccessStore, bridge: &Bridge) -> Result<Value, (i64, String)> {
    let name = params["name"].as_str().unwrap_or_default();
    let tool = catalog()
        .into_iter()
        .find(|tool| tool.name == name)
        .ok_or((-32602, format!("unknown tool {name}")))?;
    let empty = Value::Object(Map::new());
    let arguments = params.get("arguments").unwrap_or(&empty);
    let allowed = || {
        let access = store.get();
        let needs = |what: &str| {
            Err(format!(
                "{name} needs Photopipe > Settings > Agents set to let agents {what}."
            ))
        };
        if tool.see > access.see {
            needs(match tool.see {
                See::Pictures => "see pictures",
                See::Descriptions => "see descriptions",
                _ => "see details",
            })
        } else if tool.act > access.act {
            needs(if tool.act == Act::Everything {
                "do everything"
            } else {
                "do cull and edit"
            })
        } else {
            Ok(())
        }
    };
    let outcome = allowed()
        .and_then(|()| ready())
        .and_then(|()| (tool.run)(arguments, bridge))
        .and_then(|content| {
            if tool.act == Act::Off {
                allowed().map(|()| content)
            } else {
                Ok(content)
            }
        });
    Ok(match outcome {
        Ok(content) => json!({ "content": content, "isError": false }),
        Err(message) => json!({ "content": [text(message)], "isError": true }),
    })
}

fn text(text: impl Into<String>) -> Value {
    json!({ "type": "text", "text": text.into() })
}

pub fn json_text(value: &Value) -> Value {
    text(value.to_string())
}

pub fn core(method: &str, params: Value) -> Result<Value, String> {
    swift_core::request(method, Some(params))
}

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

pub fn parse<T: DeserializeOwned>(args: &Value) -> Result<T, String> {
    T::deserialize(args).map_err(|e| format!("invalid arguments: {e}"))
}

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Flag {
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
    Faces,
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
    images.sort_by(|a, b| {
        let taken = |image: &Value| image["taken"].as_f64().unwrap_or(0.0);
        taken(a).total_cmp(&taken(b))
    });
    Ok(images)
}

fn split_id(id: &str) -> Result<(&str, &str), String> {
    id.split_once('/')
        .filter(|(shoot, rel)| !shoot.is_empty() && !rel.is_empty())
        .ok_or_else(|| format!("{id} is not a photo id; ids look like \"<shoot>/<file>\""))
}

fn id_of(shoot: &str, image: &Value) -> String {
    format!("{shoot}/{}", image["rel"].as_str().unwrap_or_default())
}

fn clock(seconds: f64) -> Option<String> {
    let at = time::OffsetDateTime::from_unix_timestamp(seconds.floor() as i64).ok()?;
    Some(format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        at.year(),
        u8::from(at.month()),
        at.day(),
        at.hour(),
        at.minute(),
        at.second()
    ))
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
    if let Some(time) = image["captured"].as_f64().and_then(clock) {
        row.insert("time".into(), time.into());
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

fn list_shoots(_: &Value, _: &Bridge) -> Result<Content, String> {
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

fn list_photos(args: &Value, _: &Bridge) -> Result<Content, String> {
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

fn get_photo(args: &Value, _: &Bridge) -> Result<Content, String> {
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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Photos {
    photos: Vec<String>,
}

fn per_photo(method: &str, args: &Value, each: fn(&Value) -> Value) -> Result<Content, String> {
    let args: Photos = parse(args)?;
    if args.photos.is_empty() {
        return Err("photos is required".into());
    }
    let answered = on_agent_lane(method, json!({ "ids": args.photos }))?;
    let photos: Vec<Value> = args
        .photos
        .iter()
        .zip(answered["photos"].as_array().into_iter().flatten())
        .map(|(id, photo)| {
            let mut row = each(photo);
            row["id"] = id.clone().into();
            row
        })
        .collect();
    Ok(vec![json_text(&json!({ "photos": photos }))])
}

fn faces(args: &Value, _: &Bridge) -> Result<Content, String> {
    per_photo("faces", args, |photo| {
        match (&photo["faces"], photo["done"].as_bool()) {
            (_, Some(false)) => json!({ "pending": true }),
            (Value::Null, _) => json!({ "unreadable": true }),
            (faces, _) => json!({ "faces": faces }),
        }
    })
}

fn describe(args: &Value, _: &Bridge) -> Result<Content, String> {
    per_photo("describe", args, |photo| {
        let mut row = json!({ "description": photo["text"], "error": photo["error"] });
        if photo["unmasked"] == true {
            row["note"] =
                "described without its masks, which could not be cut on this Mac right now".into();
        }
        row
    })
}

fn look(args: &Value, _: &Bridge) -> Result<Content, String> {
    let args: Look = parse(args)?;
    let ids = &args.photos;
    if ids.is_empty() {
        return Err("photos is required".into());
    }
    if args.version == Version::Raw {
        if args.region != Region::Frame || args.at.is_some() {
            return Err("raw returns the original files, so region and at do not apply".into());
        }
        let originals = core("originals", json!({ "ids": ids }))?;
        let files: Vec<Value> = ids
            .iter()
            .zip(originals["files"].as_array().into_iter().flatten())
            .map(|(id, original)| {
                json!({ "id": id, "file": original["path"], "sidecar": original["sidecar"] })
            })
            .collect();
        return Ok(vec![json_text(&json!({ "files": files }))]);
    }
    let faces = args.region == Region::Faces;
    let sheet = args.layout == Layout::Sheet || faces;
    let mut params = json!({
        "ids": ids,
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
        (Region::Faces, None) => params["faces"] = true.into(),
        (Region::Frame | Region::Faces, Some(_)) => {
            return Err("at only applies to region \"crop\"".into())
        }
        (Region::Frame, None) => {}
    }
    let shown = on_agent_lane("look", params)?;
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
            let lead = if faces {
                "Faces sheet: cell n.f is face f of photo n, left to right, top to bottom, where"
            } else {
                "Sheet, cells numbered left to right, top to bottom:"
            };
            format!("{lead} {}", cells.join(", "))
        } else {
            photos.join(", ")
        }));
        content.push(json!({ "type": "image", "data": jpeg, "mimeType": "image/jpeg" }));
    }
    let unmasked: Vec<&str> = shown["unmasked"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|index| ids.get(index.as_u64()? as usize).map(String::as_str))
        .collect();
    if !unmasked.is_empty() {
        content.push(text(format!(
            "Shown without their masks, which could not be cut on this Mac right now: {}",
            unmasked.join(", ")
        )));
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
        assert_eq!(clock(1_786_219_265.4).unwrap(), "2026-08-08 20:01:05");
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
