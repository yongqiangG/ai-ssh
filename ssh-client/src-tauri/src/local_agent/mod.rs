use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};

use portable_pty::{Child, MasterPty};

mod agent_bin;
pub(crate) mod pty;
pub(crate) mod session_discovery;

#[derive(Debug, Clone)]
pub(crate) struct TaskSession {
    pub(crate) session_id: String,
    pub(crate) session_path: Option<String>,
}

pub(crate) struct TaskHandle {
    pub(crate) master: Mutex<Box<dyn MasterPty + Send>>,
    pub(crate) writer: Mutex<Box<dyn Write + Send>>,
    pub(crate) child: Mutex<Box<dyn Child + Send + Sync>>,
}

impl TaskHandle {
    pub(crate) fn kill(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}

pub(crate) struct TaskManager {
    tasks: Mutex<HashMap<String, Arc<TaskHandle>>>,
    sessions: Mutex<HashMap<String, TaskSession>>,
}

impl Default for TaskManager {
    fn default() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl TaskManager {
    pub(crate) fn insert_task(
        &self,
        task_id: String,
        handle: Arc<TaskHandle>,
    ) -> Result<(), String> {
        let mut tasks = self.tasks.lock().expect("task manager mutex poisoned");
        if tasks.contains_key(&task_id) {
            return Err(format!("task is already running: {task_id}"));
        }
        tasks.insert(task_id, handle);
        Ok(())
    }

    pub(crate) fn task(&self, task_id: &str) -> Option<Arc<TaskHandle>> {
        self.tasks
            .lock()
            .expect("task manager mutex poisoned")
            .get(task_id)
            .cloned()
    }

    pub(crate) fn remove_task(&self, task_id: &str) -> Option<Arc<TaskHandle>> {
        self.tasks
            .lock()
            .expect("task manager mutex poisoned")
            .remove(task_id)
    }

    pub(crate) fn remove_task_if(&self, task_id: &str, expected: &Arc<TaskHandle>) -> bool {
        let mut tasks = self.tasks.lock().expect("task manager mutex poisoned");
        let matches = tasks
            .get(task_id)
            .is_some_and(|current| Arc::ptr_eq(current, expected));
        if matches {
            tasks.remove(task_id);
        }
        matches
    }

    pub(crate) fn is_active(&self, task_id: &str) -> bool {
        self.tasks
            .lock()
            .expect("task manager mutex poisoned")
            .contains_key(task_id)
    }

    pub(crate) fn set_session(&self, task_id: String, session: TaskSession) -> bool {
        let mut sessions = self.sessions.lock().expect("task manager mutex poisoned");
        let changed = sessions
            .get(&task_id)
            .map(|previous| {
                previous.session_id != session.session_id
                    || previous.session_path != session.session_path
            })
            .unwrap_or(true);
        sessions.insert(task_id, session);
        changed
    }

    pub(crate) fn remove_session(&self, task_id: &str) {
        self.sessions
            .lock()
            .expect("task manager mutex poisoned")
            .remove(task_id);
    }

    pub(crate) fn kill_all(&self) {
        let tasks = self
            .tasks
            .lock()
            .expect("task manager mutex poisoned")
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for task in tasks {
            task.kill();
        }
        self.tasks
            .lock()
            .expect("task manager mutex poisoned")
            .clear();
        self.sessions
            .lock()
            .expect("task manager mutex poisoned")
            .clear();
    }
}
