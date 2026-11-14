use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Condvar, Mutex};
use std::time::Duration;

type Emit = Box<dyn Fn(Value) -> Result<(), String> + Send + Sync>;
type Outcome = Result<Value, String>;

pub struct Bridge {
    emit: Emit,
    pending: Mutex<HashMap<u64, SyncSender<Outcome>>>,
    next: AtomicU64,
    attached: (Mutex<bool>, Condvar),
}

/// The relay may have just started the app, and its window loads a moment after the server listens.
const ATTACH_WAIT: Duration = Duration::from_secs(20);

impl Bridge {
    pub fn new(emit: impl Fn(Value) -> Result<(), String> + Send + Sync + 'static) -> Self {
        Bridge {
            emit: Box::new(emit),
            pending: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
            attached: (Mutex::new(false), Condvar::new()),
        }
    }

    /// False when the webview's listener goes away, so a call waits for the next one instead of timing out on nobody.
    pub fn attach(&self, on: bool) {
        let (attached, ready) = &self.attached;
        *attached.lock().unwrap() = on;
        ready.notify_all();
    }

    #[cfg_attr(not(agents), allow(dead_code))]
    pub fn ask(&self, tool: &str, args: &Value, timeout: Duration) -> Outcome {
        let (attached, ready) = &self.attached;
        let (attached, _) = ready
            .wait_timeout_while(attached.lock().unwrap(), ATTACH_WAIT, |on| !*on)
            .unwrap();
        if !*attached {
            return Err("Photopipe's window has not loaded yet. Try again in a moment.".into());
        }
        drop(attached);
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = sync_channel(1);
        self.pending.lock().unwrap().insert(id, sender);
        let asked = (self.emit)(json!({ "id": id, "tool": tool, "args": args }));
        let outcome = asked.and_then(|()| {
            receiver
                .recv_timeout(timeout)
                .unwrap_or_else(|_| Err("Photopipe's window did not answer in time.".into()))
        });
        self.pending.lock().unwrap().remove(&id);
        outcome
    }

    /// A late answer to a request that already timed out is dropped.
    pub fn answer(&self, id: u64, outcome: Outcome) {
        if let Some(sender) = self.pending.lock().unwrap().remove(&id) {
            let _ = sender.send(outcome);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn an_answer_reaches_the_call_that_asked_and_a_late_one_is_dropped() {
        let bridge = Arc::new(Bridge::new(|_| Ok(())));
        bridge.attach(true);
        let answering = Arc::clone(&bridge);
        let asked =
            std::thread::spawn(move || answering.ask("rate", &json!({}), Duration::from_secs(5)));
        while bridge.pending.lock().unwrap().is_empty() {
            std::thread::yield_now();
        }
        let id = *bridge.pending.lock().unwrap().keys().next().unwrap();
        bridge.answer(id, Ok(json!({ "changed": 2 })));
        assert_eq!(asked.join().unwrap(), Ok(json!({ "changed": 2 })));

        let timed_out = bridge.ask("rate", &json!({}), Duration::from_millis(10));
        assert!(timed_out.is_err());
        bridge.answer(id + 1, Ok(json!(null)));
        assert!(bridge.pending.lock().unwrap().is_empty());
    }

    #[test]
    fn a_window_that_cannot_be_reached_fails_the_call_at_once() {
        let bridge = Bridge::new(|_| Err("no window".into()));
        bridge.attach(true);
        assert_eq!(
            bridge.ask("rate", &json!({}), Duration::from_secs(5)),
            Err("no window".into())
        );
    }
}
