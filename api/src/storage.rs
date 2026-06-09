//! File storage abstraction. v1 uses a local volume; the `Storage` trait is the
//! seam where AWS S3 will slot in later without touching callers.

use std::path::PathBuf;

use async_trait::async_trait;
use tokio::fs;

#[async_trait]
pub trait Storage: Send + Sync {
    async fn put(&self, key: &str, bytes: &[u8]) -> Result<(), String>;
    async fn get(&self, key: &str) -> Result<Vec<u8>, String>;
    async fn delete(&self, key: &str) -> Result<(), String>;
    async fn exists(&self, key: &str) -> bool;
}

/// Stores objects as files under a root directory.
pub struct LocalStorage {
    root: PathBuf,
}

impl LocalStorage {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// Resolves a key to a path, rejecting traversal and absolute keys.
    fn resolve(&self, key: &str) -> Result<PathBuf, String> {
        if key.is_empty() || key.starts_with('/') || key.split('/').any(|seg| seg == "..") {
            return Err(format!("invalid storage key: {key}"));
        }
        Ok(self.root.join(key))
    }
}

#[async_trait]
impl Storage for LocalStorage {
    async fn put(&self, key: &str, bytes: &[u8]) -> Result<(), String> {
        let path = self.resolve(key)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }
        fs::write(&path, bytes).await.map_err(|e| e.to_string())
    }

    async fn get(&self, key: &str) -> Result<Vec<u8>, String> {
        let path = self.resolve(key)?;
        fs::read(&path).await.map_err(|e| e.to_string())
    }

    async fn delete(&self, key: &str) -> Result<(), String> {
        let path = self.resolve(key)?;
        fs::remove_file(&path).await.map_err(|e| e.to_string())
    }

    async fn exists(&self, key: &str) -> bool {
        match self.resolve(key) {
            Ok(path) => fs::metadata(&path).await.is_ok(),
            Err(_) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn temp_root() -> PathBuf {
        std::env::temp_dir().join(format!("sitelens-storage-test-{}", Uuid::new_v4()))
    }

    #[tokio::test]
    async fn put_get_delete_roundtrip() {
        let root = temp_root();
        let store = LocalStorage::new(&root);

        assert!(!store.exists("a/b.txt").await);
        store.put("a/b.txt", b"hello").await.unwrap();
        assert!(store.exists("a/b.txt").await);
        assert_eq!(store.get("a/b.txt").await.unwrap(), b"hello");
        store.delete("a/b.txt").await.unwrap();
        assert!(!store.exists("a/b.txt").await);

        let _ = fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn rejects_path_traversal() {
        let store = LocalStorage::new(temp_root());
        assert!(store.put("../escape", b"x").await.is_err());
        assert!(store.put("/etc/passwd", b"x").await.is_err());
        assert!(store.put("a/../../escape", b"x").await.is_err());
        assert!(!store.exists("../escape").await);
    }
}
