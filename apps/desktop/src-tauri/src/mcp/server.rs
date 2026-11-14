use super::access::AccessStore;
use super::tools;
use serde_json::{json, Value};
use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::sync::{Arc, Mutex, Weak};
use std::thread;

/// Answered when a client names none; one that names its own gets it back, since the server uses nothing newer versions changed.
const PROTOCOL: &str = "2025-06-18";

pub struct Server {
    access: Arc<AccessStore>,
    clients: Mutex<Vec<Weak<Mutex<UnixStream>>>>,
}

impl Server {
    pub fn new(access: Arc<AccessStore>) -> Arc<Self> {
        Arc::new(Server {
            access,
            clients: Mutex::new(Vec::new()),
        })
    }

    /// Refuses when another Photopipe already answers there, so a second copy never steals the first one's agents.
    pub fn listen(self: &Arc<Self>, path: &Path) -> io::Result<()> {
        if UnixStream::connect(path).is_ok() {
            return Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                "another Photopipe answers agents",
            ));
        }
        // nothing listens, so this is a socket left behind by a crash
        let _ = std::fs::remove_file(path);
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let listener = UnixListener::bind(path)?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        let weak = Arc::downgrade(self);
        self.access.on_change(move || {
            if let Some(server) = weak.upgrade() {
                server.announce_tools();
            }
        });
        let server = Arc::clone(self);
        thread::spawn(move || {
            for stream in listener.incoming().map_while(Result::ok) {
                let server = Arc::clone(&server);
                thread::spawn(move || server.serve(stream));
            }
        });
        Ok(())
    }

    fn serve(self: Arc<Self>, stream: UnixStream) {
        let Ok(writer) = stream.try_clone() else {
            return;
        };
        let writer = Arc::new(Mutex::new(writer));
        self.clients.lock().unwrap().push(Arc::downgrade(&writer));
        for line in BufReader::new(stream).lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            let (server, writer) = (Arc::clone(&self), Arc::clone(&writer));
            // a look takes seconds, and the client may ask something else meanwhile
            thread::spawn(move || {
                let reply = match serde_json::from_str::<Value>(&line) {
                    Ok(message) => server.handle(&message),
                    Err(e) => Some(reply(Value::Null, Err((-32700, e.to_string())))),
                };
                if let Some(reply) = reply {
                    send(&writer, &reply);
                }
            });
        }
    }

    /// None for notifications and for responses to anything the server sent.
    pub fn handle(&self, message: &Value) -> Option<Value> {
        let method = message["method"].as_str()?;
        let id = message.get("id")?.clone();
        let params = &message["params"];
        let access = self.access.get();
        let result = match method {
            "initialize" => Ok(json!({
                "protocolVersion": params["protocolVersion"].as_str().unwrap_or(PROTOCOL),
                "capabilities": { "tools": { "listChanged": true } },
                "serverInfo": { "name": "photopipe", "version": env!("CARGO_PKG_VERSION") },
                "instructions": tools::instructions(access),
            })),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": tools::list(access) })),
            "tools/call" => tools::call(params, access),
            _ => Err((-32601, format!("unknown method {method}"))),
        };
        Some(reply(id, result))
    }

    fn announce_tools(&self) {
        let notice = json!({ "jsonrpc": "2.0", "method": "notifications/tools/list_changed" });
        let mut clients = self.clients.lock().unwrap();
        clients.retain(|client| client.strong_count() > 0);
        for client in clients.iter().filter_map(Weak::upgrade) {
            send(&client, &notice);
        }
    }
}

fn reply(id: Value, result: Result<Value, (i64, String)>) -> Value {
    match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => {
            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
        }
    }
}

fn send(writer: &Mutex<UnixStream>, message: &Value) {
    let mut writer = writer.lock().unwrap();
    let _ = writeln!(writer, "{message}");
}

#[cfg(test)]
mod tests {
    use super::super::access::{Access, See};
    use super::*;
    use objc2_foundation::{NSString, NSUserDefaults};

    fn server(tag: &str, see: See) -> (Arc<Server>, String) {
        let suite = format!("net.photopipe.desktop.tests.mcp-{tag}");
        NSUserDefaults::standardUserDefaults()
            .removePersistentDomainForName(&NSString::from_str(&suite));
        let access = Arc::new(AccessStore::load(Some(&suite)));
        access.set(Access { see });
        (Server::new(access), suite)
    }

    fn forget(suite: &str) {
        NSUserDefaults::standardUserDefaults()
            .removePersistentDomainForName(&NSString::from_str(suite));
    }

    fn names(server: &Server) -> Vec<String> {
        let listed = server
            .handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }))
            .unwrap();
        listed["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap().to_owned())
            .collect()
    }

    #[test]
    fn initialize_echoes_the_clients_protocol_and_notifications_get_no_reply() {
        let (server, suite) = server("init", See::Off);
        let answer = server
            .handle(&json!({
                "jsonrpc": "2.0", "id": "a", "method": "initialize",
                "params": { "protocolVersion": "2025-03-26" }
            }))
            .unwrap();
        assert_eq!(answer["id"], "a");
        assert_eq!(answer["result"]["protocolVersion"], "2025-03-26");
        assert!(server
            .handle(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
            .is_none());
        assert_eq!(
            server
                .handle(&json!({ "jsonrpc": "2.0", "id": 2, "method": "nope" }))
                .unwrap()["error"]["code"],
            -32601
        );
        forget(&suite);
    }

    #[test]
    fn only_the_tools_the_access_level_allows_are_listed() {
        let (server, suite) = server("levels", See::Off);
        assert!(names(&server).is_empty());
        server.access.set(Access { see: See::Details });
        assert!(names(&server).contains(&"list_photos".to_owned()));
        assert!(!names(&server).contains(&"look".to_owned()));
        server.access.set(Access { see: See::Pictures });
        assert!(names(&server).contains(&"look".to_owned()));
        forget(&suite);
    }

    #[test]
    fn a_tool_above_the_level_is_refused_with_the_setting_to_change() {
        let (server, suite) = server("refused", See::Details);
        let answer = server
            .handle(&json!({
                "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                "params": { "name": "look", "arguments": { "photos": ["a/b.jpg"] } }
            }))
            .unwrap();
        assert_eq!(answer["result"]["isError"], true);
        let text = answer["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("Settings"), "{text}");
        forget(&suite);
    }

    #[test]
    fn a_connected_client_hears_when_its_tools_change() {
        let (server, suite) = server("announce", See::Off);
        let path = std::env::temp_dir().join(format!("pp-mcp-{}.sock", std::process::id()));
        server.listen(&path).unwrap();
        let client = UnixStream::connect(&path).unwrap();
        let mut lines = BufReader::new(client.try_clone().unwrap()).lines();
        writeln!(&client, r#"{{"jsonrpc":"2.0","id":1,"method":"ping"}}"#).unwrap();
        assert!(lines.next().unwrap().unwrap().contains(r#""id":1"#));

        server.access.set(Access { see: See::Details });
        assert!(lines
            .next()
            .unwrap()
            .unwrap()
            .contains("notifications/tools/list_changed"));
        assert!(
            server.listen(&path).is_err(),
            "a second server must not take over a live socket"
        );
        let _ = std::fs::remove_file(&path);
        forget(&suite);
    }
}
