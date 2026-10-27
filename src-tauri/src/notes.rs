use std::fs;
use std::io::{self, Write};
use std::path::Path;
use std::time::UNIX_EPOCH;

use chrono::{Local, NaiveDateTime};
use serde::Serialize;
use tauri::AppHandle;

use crate::config;
use crate::error::{AppError, AppResult};

const NOTE_EXTS: [&str; 2] = ["md", "txt"];
// Illegal on Windows (and `/` everywhere); rejecting them keeps notes portable.
const FORBIDDEN_CHARS: [char; 9] = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
const MAX_STEM_LEN: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NoteMeta {
    pub path: String,
    pub name: String,
    pub modified_ms: u64,
    pub ext: String,
}

/// `YYYY-MM-DD HH-mm.md`, or `... (2).md`, `... (3).md` when that name is taken.
pub fn note_filename(now: NaiveDateTime, exists: impl Fn(&str) -> bool) -> String {
    let stem = now.format("%Y-%m-%d %H-%M").to_string();
    let first = format!("{stem}.md");
    if !exists(&first) {
        return first;
    }
    let mut n = 2;
    loop {
        let candidate = format!("{stem} ({n}).md");
        if !exists(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// Lowercased extension if it is one we support.
fn note_ext(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    NOTE_EXTS.contains(&ext.as_str()).then_some(ext)
}

fn require_note_ext(path: &Path) -> AppResult<String> {
    note_ext(path).ok_or_else(|| AppError::msg("Only .md and .txt files are supported"))
}

/// Write to `<name>.tmp` then rename over the target, so a crash can't leave a half-written note.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let mut tmp_name = path
        .file_name()
        .ok_or_else(|| AppError::msg("Invalid file path"))?
        .to_os_string();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);
    fs::write(&tmp, bytes)?;
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

fn meta_for(path: &Path) -> AppResult<NoteMeta> {
    let modified_ms = fs::metadata(path)?
        .modified()?
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(NoteMeta {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        modified_ms,
        ext: note_ext(path).unwrap_or_default(),
    })
}

/// `.md`/`.txt` files directly inside `dir` (no subfolders, no dotfiles), newest first.
pub fn list_in(dir: &Path) -> AppResult<Vec<NoteMeta>> {
    let mut notes = Vec::new();
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        let hidden = path
            .file_name()
            .and_then(|n| n.to_str())
            .is_none_or(|n| n.starts_with('.'));
        if hidden || note_ext(&path).is_none() || !path.is_file() {
            continue;
        }
        if let Ok(meta) = meta_for(&path) {
            notes.push(meta);
        }
    }
    notes.sort_by(|a, b| {
        b.modified_ms
            .cmp(&a.modified_ms)
            .then_with(|| b.name.cmp(&a.name))
    });
    Ok(notes)
}

pub fn read_at(path: &Path) -> AppResult<String> {
    require_note_ext(path)?;
    fs::read_to_string(path).map_err(|e| match e.kind() {
        io::ErrorKind::InvalidData => AppError::msg("This file isn't valid UTF-8 text"),
        _ => e.into(),
    })
}

/// Saves `content` to `path`. Unless `create_if_missing` is set, a file that no longer exists
/// (deleted or moved while it was open) is reported as `Missing` rather than silently recreated.
pub fn write_at(path: &Path, content: &str, create_if_missing: bool) -> AppResult<NoteMeta> {
    require_note_ext(path)?;
    if !create_if_missing && !path.exists() {
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned());
        return Err(AppError::Missing(format!(
            "\"{}\" no longer exists",
            name.unwrap_or_default()
        )));
    }
    atomic_write(path, content.as_bytes())?;
    meta_for(path)
}

/// Creates a new `YYYY-MM-DD HH-mm.md` in `dir` without ever overwriting an existing file.
pub fn create_in(dir: &Path, content: &str, now: NaiveDateTime) -> AppResult<NoteMeta> {
    for _ in 0..100 {
        let path = dir.join(note_filename(now, |name| dir.join(name).exists()));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                file.write_all(content.as_bytes())?;
                return meta_for(&path);
            }
            // Lost a race with another writer: pick the next free name.
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(AppError::msg("Couldn't find a free file name"))
}

pub fn validate_stem(stem: &str) -> AppResult<()> {
    let stem = stem.trim();
    if stem.is_empty() {
        return Err(AppError::msg("Name can't be empty"));
    }
    if stem.chars().count() > MAX_STEM_LEN {
        return Err(AppError::msg("Name is too long"));
    }
    if stem.chars().any(|c| FORBIDDEN_CHARS.contains(&c) || c.is_control()) {
        return Err(AppError::msg("Name can't contain / \\ : * ? \" < > |"));
    }
    // A leading dot would hide the note from the sidebar (dotfiles are ignored).
    if stem.starts_with('.') || stem.ends_with('.') {
        return Err(AppError::msg("Name can't start or end with a dot"));
    }
    Ok(())
}

fn same_file(a: &Path, b: &Path) -> bool {
    matches!((fs::canonicalize(a), fs::canonicalize(b)), (Ok(x), Ok(y)) if x == y)
}

/// Renames a note, keeping its extension.
pub fn rename_in(path: &Path, new_stem: &str) -> AppResult<NoteMeta> {
    let ext = require_note_ext(path)?;
    validate_stem(new_stem)?;
    let stem = new_stem.trim();
    let target = path.with_file_name(format!("{stem}.{ext}"));
    if target == path {
        return meta_for(path);
    }
    // `exists()` is also true for a case-only rename on case-insensitive filesystems.
    if target.exists() && !same_file(&target, path) {
        return Err(AppError::msg(format!(
            "A draft named \"{stem}.{ext}\" already exists"
        )));
    }
    fs::rename(path, &target)?;
    meta_for(&target)
}

/// True when `path` is inside `dir` (at any depth). Both are canonicalized, so `..` tricks and
/// symlinks pointing out of the folder don't count as "inside". Missing paths are never inside.
pub fn is_inside(dir: &Path, path: &Path) -> bool {
    match (fs::canonicalize(dir), fs::canonicalize(path)) {
        (Ok(dir), Ok(path)) => path.starts_with(dir),
        _ => false,
    }
}

#[tauri::command]
pub fn is_in_notes_dir(app: AppHandle, path: String) -> AppResult<bool> {
    Ok(is_inside(&config::notes_dir(&app)?, Path::new(&path)))
}

#[tauri::command]
pub fn list_notes(app: AppHandle) -> AppResult<Vec<NoteMeta>> {
    list_in(&config::notes_dir(&app)?)
}

#[tauri::command]
pub fn read_note(path: String) -> AppResult<String> {
    read_at(Path::new(&path))
}

#[tauri::command]
pub fn write_note(path: String, content: String, create_if_missing: bool) -> AppResult<NoteMeta> {
    write_at(Path::new(&path), &content, create_if_missing)
}

#[tauri::command]
pub fn create_note(app: AppHandle, content: String) -> AppResult<NoteMeta> {
    create_in(&config::notes_dir(&app)?, &content, Local::now().naive_local())
}

#[tauri::command]
pub fn rename_note(path: String, new_stem: String) -> AppResult<NoteMeta> {
    rename_in(Path::new(&path), &new_stem)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use std::collections::HashSet;
    use std::time::{Duration, SystemTime};

    fn at(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, mo, d)
            .unwrap()
            .and_hms_opt(h, mi, 0)
            .unwrap()
    }

    fn set_mtime(path: &Path, secs: u64) {
        let file = fs::File::options().write(true).open(path).unwrap();
        file.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(secs))
            .unwrap();
    }

    #[test]
    fn filename_is_zero_padded() {
        let name = note_filename(at(2026, 1, 5, 3, 7), |_| false);
        assert_eq!(name, "2026-01-05 03-07.md");
        let name = note_filename(at(2026, 10, 27, 14, 5), |_| false);
        assert_eq!(name, "2026-10-27 14-05.md");
    }

    #[test]
    fn filename_collisions_get_a_counter() {
        let now = at(2026, 10, 27, 14, 5);
        let mut taken: HashSet<String> = HashSet::new();
        taken.insert("2026-10-27 14-05.md".into());
        assert_eq!(
            note_filename(now, |n| taken.contains(n)),
            "2026-10-27 14-05 (2).md"
        );
        taken.insert("2026-10-27 14-05 (2).md".into());
        assert_eq!(
            note_filename(now, |n| taken.contains(n)),
            "2026-10-27 14-05 (3).md"
        );
    }

    #[test]
    fn create_in_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let now = at(2026, 10, 27, 14, 5);
        let a = create_in(dir.path(), "first", now).unwrap();
        let b = create_in(dir.path(), "second", now).unwrap();
        assert_eq!(a.name, "2026-10-27 14-05.md");
        assert_eq!(b.name, "2026-10-27 14-05 (2).md");
        assert_eq!(fs::read_to_string(&a.path).unwrap(), "first");
        assert_eq!(fs::read_to_string(&b.path).unwrap(), "second");
    }

    #[test]
    fn validate_stem_rejects_each_forbidden_char() {
        for c in FORBIDDEN_CHARS {
            let stem = format!("a{c}b");
            assert!(validate_stem(&stem).is_err(), "{stem:?} should be rejected");
        }
    }

    #[test]
    fn validate_stem_rejects_empty_and_dotted_names() {
        assert!(validate_stem("").is_err());
        assert!(validate_stem("   ").is_err());
        assert!(validate_stem(".hidden").is_err());
        assert!(validate_stem("trailing.").is_err());
        assert!(validate_stem("2026-10-27 meeting notes").is_ok());
    }

    #[test]
    fn rename_keeps_extension_and_moves_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("old.txt");
        fs::write(&path, "hi").unwrap();
        let meta = rename_in(&path, "new name").unwrap();
        assert_eq!(meta.name, "new name.txt");
        assert!(!path.exists());
        assert_eq!(fs::read_to_string(&meta.path).unwrap(), "hi");
    }

    #[test]
    fn rename_rejects_existing_target_and_bad_names() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        fs::write(&a, "a").unwrap();
        fs::write(&b, "b").unwrap();
        assert!(rename_in(&a, "b").is_err());
        assert!(rename_in(&a, "x:y").is_err());
        assert_eq!(fs::read_to_string(&a).unwrap(), "a");
        assert_eq!(fs::read_to_string(&b).unwrap(), "b");
    }

    #[test]
    fn rename_to_same_name_is_a_no_op() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        fs::write(&a, "a").unwrap();
        assert_eq!(rename_in(&a, "a").unwrap().name, "a.md");
    }

    #[test]
    fn list_ignores_other_files_and_sorts_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let p = |n: &str| dir.path().join(n);
        for (name, mtime) in [("old.md", 100), ("new.txt", 300), ("mid.md", 200)] {
            fs::write(p(name), "x").unwrap();
            set_mtime(&p(name), mtime);
        }
        fs::write(p("image.png"), "x").unwrap();
        fs::write(p("notes.md.tmp"), "x").unwrap();
        fs::write(p(".hidden.md"), "x").unwrap();
        fs::create_dir(p("folder.md")).unwrap();

        let names: Vec<String> = list_in(dir.path())
            .unwrap()
            .into_iter()
            .map(|n| n.name)
            .collect();
        assert_eq!(names, ["new.txt", "mid.md", "old.md"]);
    }

    #[test]
    fn is_inside_accepts_files_at_any_depth() {
        let dir = tempfile::tempdir().unwrap();
        let top = dir.path().join("a.md");
        fs::write(&top, "x").unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        let nested = dir.path().join("sub").join("b.md");
        fs::write(&nested, "x").unwrap();
        assert!(is_inside(dir.path(), &top));
        assert!(is_inside(dir.path(), &nested));
    }

    #[test]
    fn is_inside_rejects_outside_siblings_and_missing_files() {
        let root = tempfile::tempdir().unwrap();
        let notes = root.path().join("notes");
        let lookalike = root.path().join("notes-other"); // shares a name prefix
        fs::create_dir(&notes).unwrap();
        fs::create_dir(&lookalike).unwrap();
        let outside = lookalike.join("c.md");
        fs::write(&outside, "x").unwrap();
        assert!(!is_inside(&notes, &outside));
        assert!(!is_inside(&notes, &notes.join("missing.md")));
        assert!(!is_inside(&root.path().join("no-such-dir"), &outside));
    }

    #[cfg(unix)]
    #[test]
    fn is_inside_rejects_symlinks_that_point_outside() {
        let root = tempfile::tempdir().unwrap();
        let notes = root.path().join("notes");
        fs::create_dir(&notes).unwrap();
        let target = root.path().join("elsewhere.md");
        fs::write(&target, "x").unwrap();
        let link = notes.join("link.md");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(!is_inside(&notes, &link));
    }

    #[test]
    fn write_and_read_round_trip_and_reject_other_extensions() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("n.md");
        write_at(&path, "# Title\n", true).unwrap();
        assert_eq!(read_at(&path).unwrap(), "# Title\n");
        assert!(!dir.path().join("n.md.tmp").exists());
        assert!(write_at(&dir.path().join("evil.sh"), "x", true).is_err());
        assert!(read_at(&dir.path().join("evil.sh")).is_err());
    }

    #[test]
    fn write_to_an_existing_file_needs_no_permission_to_create() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("n.md");
        fs::write(&path, "old").unwrap();
        write_at(&path, "new", false).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn write_does_not_recreate_a_deleted_file_unless_asked() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gone.md");
        fs::write(&path, "text").unwrap();
        fs::remove_file(&path).unwrap();

        let err = write_at(&path, "typed after deletion", false).unwrap_err();
        assert!(matches!(err, AppError::Missing(_)), "got {err:?}");
        assert!(!path.exists(), "the file must not come back by itself");
        assert!(!dir.path().join("gone.md.tmp").exists());

        write_at(&path, "saved again", true).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "saved again");
    }
}
