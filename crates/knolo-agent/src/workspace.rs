use knolo_agent_core::CoreError;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
};

/// Native host boundary for workspace effects. Remote, virtual, and read-only
/// implementations can provide the same operations without changing the task
/// loop or portable contracts.
pub trait WorkspaceHost {
    fn inspect(&self) -> Result<Value, CoreError>;
    fn read_file(&self, path: &str) -> Result<Value, CoreError>;
    fn write_file(&self, path: &str, content: &str) -> Result<Value, CoreError>;
    fn execute(&self, program: &str, args: &[String]) -> Result<Value, CoreError>;
}

pub struct LocalWorkspaceHost {
    root: PathBuf,
}

impl LocalWorkspaceHost {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn safe_path(&self, path: &str) -> Result<PathBuf, CoreError> {
        let relative = Path::new(path);
        if relative.is_absolute()
            || relative
                .components()
                .any(|component| matches!(component, Component::ParentDir))
        {
            return Err(CoreError::Host(
                "path must stay inside the workspace".into(),
            ));
        }
        Ok(self.root.join(relative))
    }
}

impl WorkspaceHost for LocalWorkspaceHost {
    fn inspect(&self) -> Result<Value, CoreError> {
        let mut entries = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(|error| CoreError::Host(error.to_string()))? {
            let entry = entry.map_err(|error| CoreError::Host(error.to_string()))?;
            entries.push(entry.file_name().to_string_lossy().to_string());
        }
        entries.sort();
        Ok(json!({"workspace": self.root, "entries": entries}))
    }

    fn read_file(&self, path: &str) -> Result<Value, CoreError> {
        let path = self.safe_path(path)?;
        let content =
            fs::read_to_string(path).map_err(|error| CoreError::Host(error.to_string()))?;
        Ok(json!({"content": content}))
    }

    fn write_file(&self, path: &str, content: &str) -> Result<Value, CoreError> {
        let path = self.safe_path(path)?;
        fs::write(&path, content).map_err(|error| CoreError::Host(error.to_string()))?;
        Ok(json!({"written": path, "bytes": content.len()}))
    }

    fn execute(&self, program: &str, args: &[String]) -> Result<Value, CoreError> {
        if program.trim().is_empty() {
            return Err(CoreError::Host("command program cannot be empty".into()));
        }
        let output = Command::new(program)
            .args(args)
            .current_dir(&self.root)
            .output()
            .map_err(|error| CoreError::Host(format!("execute {program}: {error}")))?;
        if !output.status.success() {
            return Err(CoreError::Host(format!(
                "execute {program} failed with {:?}: stdout={} stderr={}",
                output.status.code(),
                bounded_output(&output.stdout),
                bounded_output(&output.stderr)
            )));
        }
        Ok(json!({
            "program": program,
            "args": args,
            "status": output.status.code(),
            "success": output.status.success(),
            "stdout": bounded_output(&output.stdout),
            "stderr": bounded_output(&output.stderr),
        }))
    }
}

fn bounded_output(bytes: &[u8]) -> String {
    const MAX_OUTPUT_BYTES: usize = 64 * 1024;
    let end = bytes.len().min(MAX_OUTPUT_BYTES);
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "knolo-workspace-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn local_workspace_reads_writes_and_rejects_escape() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let workspace = LocalWorkspaceHost::new(root);
        workspace.write_file("note.txt", "hello").unwrap();
        assert_eq!(workspace.read_file("note.txt").unwrap()["content"], "hello");
        assert!(workspace.read_file("../outside").is_err());
    }
}
