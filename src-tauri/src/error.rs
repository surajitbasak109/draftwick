use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    /// The file the operation needs is gone, e.g. a note deleted outside the app while open.
    #[error("{0}")]
    Missing(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
}

impl AppError {
    pub fn msg(message: impl Into<String>) -> Self {
        AppError::Message(message.into())
    }

    /// A stable label the frontend can branch on without parsing the message.
    fn kind(&self) -> &'static str {
        match self {
            AppError::Missing(_) => "missing",
            _ => "error",
        }
    }
}

// The frontend receives errors as `{ kind: string, message: string }`.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_serialize_with_a_kind_and_message() {
        let missing = serde_json::to_value(AppError::Missing("gone".into())).unwrap();
        assert_eq!(missing, serde_json::json!({ "kind": "missing", "message": "gone" }));

        let other = serde_json::to_value(AppError::msg("nope")).unwrap();
        assert_eq!(other, serde_json::json!({ "kind": "error", "message": "nope" }));

        let io = serde_json::to_value(AppError::from(std::io::Error::other("disk"))).unwrap();
        assert_eq!(io["kind"], "error");
    }
}
