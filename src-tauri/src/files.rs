//! The only file-system access FormFlow has.
//!
//! The webview cannot touch the disk directly (no `fs` plugin is enabled). These
//! commands are the whole surface:
//!
//! * `pick_pdf` shows a native open dialog; the chosen path is *granted*.
//! * `read_pdf` reads a granted path, and only if it is a regular `.pdf` file
//!   with a PDF header, under a size limit.
//! * `save_pdf` shows a native save dialog and writes there atomically. It never
//!   writes over the document that was opened.
//! * `reveal_file` shows a file FormFlow saved in this session in Finder/Explorer.
//! * `forget_path` revokes grants (used by "remove from recents" and "clear data").
//!
//! Opened paths are remembered (at most [`MAX_GRANTS`]) in the app data folder so
//! the recent-files list can reopen them after a restart. Paths and file contents
//! are never logged.

use std::collections::{HashSet, VecDeque};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use percent_encoding::percent_decode_str;
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub const MAX_PDF_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_GRANTS: usize = 30;
const HEADER_SCAN: usize = 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum FileError {
    NotPdf(String),
    NotFound(String),
    NotAllowed(String),
    SameAsSource,
    Io(String),
}

impl From<FileError> for String {
    /// Errors cross the IPC boundary as `code: message`; see src/platform/tauri.ts.
    fn from(e: FileError) -> String {
        match e {
            FileError::NotPdf(m) => format!("not-pdf: {m}"),
            FileError::NotFound(m) => format!("not-found: {m}"),
            FileError::NotAllowed(m) => format!("not-allowed: {m}"),
            FileError::SameAsSource => {
                "same-as-source: Choose a different name — FormFlow never overwrites the original PDF.".into()
            }
            FileError::Io(m) => format!("io: {m}"),
        }
    }
}

type CmdResult<T> = Result<T, String>;

#[derive(Serialize)]
pub struct Picked {
    path: String,
    name: String,
}

impl Picked {
    fn from_path(p: &Path) -> Self {
        Picked {
            path: p.to_string_lossy().into_owned(),
            name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "document.pdf".into()),
        }
    }
}

// ---------------------------------------------------------------------------
// Validation (pure, unit-tested)
// ---------------------------------------------------------------------------

fn has_pdf_extension(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
}

/// Resolves `path` to a canonical regular `.pdf` file within the size limit.
pub fn validate_pdf_path(path: &Path) -> Result<PathBuf, FileError> {
    if !path.is_absolute() {
        return Err(FileError::NotAllowed("Only absolute paths can be opened.".into()));
    }
    let canonical = fs::canonicalize(path).map_err(|_| FileError::NotFound("The file no longer exists or was moved.".into()))?;
    let meta = fs::metadata(&canonical).map_err(|e| FileError::Io(e.kind().to_string()))?;
    if !meta.is_file() {
        return Err(FileError::NotPdf("That isn’t a file.".into()));
    }
    if !has_pdf_extension(&canonical) {
        return Err(FileError::NotPdf("Only .pdf files can be opened.".into()));
    }
    if meta.len() > MAX_PDF_BYTES {
        return Err(FileError::NotPdf("That PDF is larger than 512 MB.".into()));
    }
    Ok(canonical)
}

/// True when `%PDF-` appears near the start (some producers prepend junk bytes).
pub fn has_pdf_header(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(HEADER_SCAN)];
    head.windows(5).any(|w| w == b"%PDF-")
}

/// Makes a suggested name safe for a save dialog: no separators, control or
/// reserved characters, bounded length, and a `.pdf` extension.
pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { '-' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    let mut base = if trimmed.is_empty() { "document-filled.pdf".to_string() } else { trimmed.to_string() };
    if !has_pdf_extension(Path::new(&base)) {
        base.push_str(".pdf");
    }
    if base.chars().count() > 180 {
        let stem: String = base.chars().take(176).collect();
        base = format!("{}.pdf", stem.trim_end_matches(".pdf"));
    }
    base
}

/// Whether two paths name the same file. Uses file identity where both exist so
/// case-insensitive file systems and hard links are handled.
pub fn same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(ca), Ok(cb)) => {
            if ca == cb {
                return true;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if let (Ok(ma), Ok(mb)) = (fs::metadata(&ca), fs::metadata(&cb)) {
                    return ma.dev() == mb.dev() && ma.ino() == mb.ino();
                }
            }
            #[cfg(windows)]
            {
                return ca.to_string_lossy().to_lowercase() == cb.to_string_lossy().to_lowercase();
            }
            #[allow(unreachable_code)]
            false
        }
        _ => false,
    }
}

/// Checks a save-dialog result: forces a `.pdf` extension and refuses the source document.
pub fn resolve_save_target(target: &Path, source: Option<&Path>) -> Result<PathBuf, FileError> {
    if !target.is_absolute() {
        return Err(FileError::NotAllowed("Choose a location in the save dialog.".into()));
    }
    let mut target = target.to_path_buf();
    if !has_pdf_extension(&target) {
        let mut name = target.file_name().map(|n| n.to_os_string()).unwrap_or_default();
        name.push(".pdf");
        target.set_file_name(name);
    }
    if target.is_dir() {
        return Err(FileError::NotAllowed("That name belongs to a folder.".into()));
    }
    if let Some(src) = source {
        if same_file(&target, src) {
            return Err(FileError::SameAsSource);
        }
    }
    Ok(target)
}

/// Writes through a temporary file in the same folder, then renames, so a crash
/// never leaves a half-written PDF under the chosen name.
pub fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), FileError> {
    let dir = target.parent().ok_or_else(|| FileError::NotAllowed("Invalid location.".into()))?;
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = dir.join(format!(".{name}.formflow-{}.tmp", std::process::id()));
    let result = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, target)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(match e.kind() {
            std::io::ErrorKind::PermissionDenied => FileError::NotAllowed("FormFlow doesn’t have permission to save there.".into()),
            k => FileError::Io(k.to_string()),
        });
    }
    Ok(())
}

pub fn read_validated(path: &Path) -> Result<Vec<u8>, FileError> {
    let canonical = validate_pdf_path(path)?;
    let f = fs::File::open(&canonical).map_err(|e| match e.kind() {
        std::io::ErrorKind::PermissionDenied => FileError::NotAllowed("FormFlow doesn’t have permission to read that file.".into()),
        k => FileError::Io(k.to_string()),
    })?;
    let mut bytes = Vec::new();
    f.take(MAX_PDF_BYTES + 1).read_to_end(&mut bytes).map_err(|e| FileError::Io(e.kind().to_string()))?;
    if bytes.len() as u64 > MAX_PDF_BYTES {
        return Err(FileError::NotPdf("That PDF is larger than 512 MB.".into()));
    }
    if !has_pdf_header(&bytes) {
        return Err(FileError::NotPdf("This file isn’t a PDF, even though its name ends in .pdf.".into()));
    }
    Ok(bytes)
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

struct GrantsInner {
    store: PathBuf,
    /// Most recently opened first; persisted.
    opened: VecDeque<PathBuf>,
    /// Files saved this session; may be revealed.
    saved: HashSet<PathBuf>,
}

pub struct Grants(Mutex<GrantsInner>);

impl Grants {
    pub fn load(store: PathBuf) -> Self {
        let opened = fs::read_to_string(&store)
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<PathBuf>>(&s).ok())
            .unwrap_or_default()
            .into_iter()
            .filter(|p| p.is_absolute())
            .take(MAX_GRANTS)
            .collect();
        Grants(Mutex::new(GrantsInner { store, opened, saved: HashSet::new() }))
    }

    fn with<T>(&self, f: impl FnOnce(&mut GrantsInner) -> T) -> T {
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut g)
    }

    fn grant_opened(&self, p: &Path) {
        self.with(|g| {
            g.opened.retain(|x| x != p);
            g.opened.push_front(p.to_path_buf());
            g.opened.truncate(MAX_GRANTS);
            persist(g);
        });
    }

    fn is_opened(&self, p: &Path) -> bool {
        self.with(|g| g.opened.iter().any(|x| x == p))
    }

    fn grant_saved(&self, p: &Path) {
        self.with(|g| {
            g.saved.insert(p.to_path_buf());
        });
    }

    fn is_saved(&self, p: &Path) -> bool {
        self.with(|g| g.saved.contains(p))
    }

    fn forget(&self, p: Option<&Path>) {
        self.with(|g| {
            match p {
                Some(p) => g.opened.retain(|x| x != p),
                None => g.opened.clear(),
            }
            persist(g);
        });
    }
}

fn persist(g: &GrantsInner) {
    if let Some(dir) = g.store.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let list: Vec<&PathBuf> = g.opened.iter().collect();
    if let Ok(json) = serde_json::to_string(&list) {
        let _ = write_atomic_plain(&g.store, json.as_bytes());
    }
}

fn write_atomic_plain(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = target.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(tmp, target)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn pick_pdf(app: AppHandle, grants: State<'_, Grants>) -> CmdResult<Option<Picked>> {
    let Some(choice) = app.dialog().file().add_filter("PDF document", &["pdf", "PDF"]).blocking_pick_file() else {
        return Ok(None);
    };
    let path = choice.into_path().map_err(|_| String::from(FileError::NotAllowed("That location can’t be opened.".into())))?;
    let canonical = validate_pdf_path(&path)?;
    grants.grant_opened(&canonical);
    Ok(Some(Picked::from_path(&canonical)))
}

#[tauri::command]
pub async fn read_pdf(path: String, grants: State<'_, Grants>) -> CmdResult<Response> {
    let canonical = validate_pdf_path(Path::new(&path))?;
    if !grants.is_opened(&canonical) {
        return Err(FileError::NotAllowed("Open this file again from the Open dialog.".into()).into());
    }
    let bytes = read_validated(&canonical)?;
    grants.grant_opened(&canonical);
    Ok(Response::new(bytes))
}

fn header(request: &Request<'_>, name: &str) -> Option<String> {
    let raw = request.headers().get(name)?.to_str().ok()?;
    let decoded = percent_decode_str(raw).decode_utf8().ok()?.into_owned();
    (!decoded.is_empty()).then_some(decoded)
}

#[tauri::command]
pub async fn save_pdf(app: AppHandle, grants: State<'_, Grants>, request: Request<'_>) -> CmdResult<Option<Picked>> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(FileError::Io("Expected the PDF bytes.".into()).into());
    };
    if !has_pdf_header(bytes) {
        return Err(FileError::Io("The exported document is not a valid PDF.".into()).into());
    }
    let suggested = sanitize_file_name(&header(&request, "x-suggested-name").unwrap_or_default());
    let source = header(&request, "x-source-path").map(PathBuf::from);

    let mut dialog = app.dialog().file().add_filter("PDF document", &["pdf"]).set_file_name(&suggested);
    if let Some(dir) = source.as_deref().and_then(Path::parent).filter(|d| d.is_dir()) {
        dialog = dialog.set_directory(dir);
    }
    let Some(choice) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let chosen = choice.into_path().map_err(|_| String::from(FileError::NotAllowed("That location can’t be used.".into())))?;
    let target = resolve_save_target(&chosen, source.as_deref())?;
    write_atomic(&target, bytes)?;
    let saved = fs::canonicalize(&target).unwrap_or(target);
    grants.grant_saved(&saved);
    Ok(Some(Picked::from_path(&saved)))
}

#[tauri::command]
pub async fn reveal_file(app: AppHandle, path: String, grants: State<'_, Grants>) -> CmdResult<()> {
    let canonical = fs::canonicalize(&path).map_err(|_| String::from(FileError::NotFound("The file was moved or deleted.".into())))?;
    if !grants.is_saved(&canonical) {
        return Err(FileError::NotAllowed("Only files saved by FormFlow can be shown.".into()).into());
    }
    app.opener().reveal_item_in_dir(&canonical).map_err(|_| String::from(FileError::Io("Couldn’t show the file.".into())))
}

/// Revokes the grant for one path, or all of them when `path` is null.
#[tauri::command]
pub async fn forget_path(path: Option<String>, grants: State<'_, Grants>) -> CmdResult<()> {
    match path {
        Some(p) => {
            let p = PathBuf::from(p);
            let canonical = fs::canonicalize(&p).unwrap_or(p);
            grants.forget(Some(&canonical));
        }
        None => grants.forget(None),
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn pdf_bytes() -> Vec<u8> {
        b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\n%%EOF\n".to_vec()
    }

    #[test]
    fn header_detection() {
        assert!(has_pdf_header(&pdf_bytes()));
        let mut junk = vec![b' '; 100];
        junk.extend(pdf_bytes());
        assert!(has_pdf_header(&junk));
        assert!(!has_pdf_header(b"PK\x03\x04 not a pdf"));
        assert!(!has_pdf_header(b""));
        let mut far = vec![b' '; 2000];
        far.extend(pdf_bytes());
        assert!(!has_pdf_header(&far));
    }

    #[test]
    fn validates_paths() {
        let dir = tempfile::tempdir().unwrap();
        let pdf = dir.path().join("Form.PDF");
        fs::write(&pdf, pdf_bytes()).unwrap();
        let txt = dir.path().join("notes.txt");
        fs::write(&txt, b"hello").unwrap();

        assert!(validate_pdf_path(&pdf).is_ok());
        assert!(matches!(validate_pdf_path(&txt), Err(FileError::NotPdf(_))));
        assert!(matches!(validate_pdf_path(dir.path()), Err(FileError::NotPdf(_))));
        assert!(matches!(validate_pdf_path(&dir.path().join("missing.pdf")), Err(FileError::NotFound(_))));
        assert!(matches!(validate_pdf_path(Path::new("relative.pdf")), Err(FileError::NotAllowed(_))));
    }

    #[test]
    fn rejects_renamed_non_pdf() {
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("fake.pdf");
        fs::write(&fake, b"PK\x03\x04 zip pretending").unwrap();
        assert!(matches!(read_validated(&fake), Err(FileError::NotPdf(_))));
        let real = dir.path().join("real.pdf");
        fs::write(&real, pdf_bytes()).unwrap();
        assert_eq!(read_validated(&real).unwrap(), pdf_bytes());
    }

    #[test]
    fn sanitizes_names() {
        assert_eq!(sanitize_file_name("lease-filled.pdf"), "lease-filled.pdf");
        assert_eq!(sanitize_file_name("../../etc/passwd"), "-..-etc-passwd.pdf");
        assert_eq!(sanitize_file_name("a:b*c?.pdf"), "a-b-c-.pdf");
        assert_eq!(sanitize_file_name("  "), "document-filled.pdf");
        assert_eq!(sanitize_file_name("טופס-filled"), "טופס-filled.pdf");
        assert!(sanitize_file_name(&"x".repeat(400)).chars().count() <= 180);
        assert!(sanitize_file_name(&"x".repeat(400)).ends_with(".pdf"));
    }

    #[test]
    fn never_overwrites_source() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("lease.pdf");
        fs::write(&src, pdf_bytes()).unwrap();

        assert_eq!(resolve_save_target(&src, Some(&src)), Err(FileError::SameAsSource));
        // Same file reached through a different spelling of the path.
        let indirect = dir.path().join(".").join("lease.pdf");
        assert_eq!(resolve_save_target(&indirect, Some(&src)), Err(FileError::SameAsSource));
        // Missing extension is added — and then recognised as the source.
        assert_eq!(resolve_save_target(&dir.path().join("lease"), Some(&src)), Err(FileError::SameAsSource));

        let out = resolve_save_target(&dir.path().join("lease-filled"), Some(&src)).unwrap();
        assert_eq!(out.file_name().unwrap(), "lease-filled.pdf");
        assert!(resolve_save_target(Path::new("rel.pdf"), None).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn hard_link_counts_as_source() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.pdf");
        fs::write(&src, pdf_bytes()).unwrap();
        let link = dir.path().join("b.pdf");
        fs::hard_link(&src, &link).unwrap();
        assert_eq!(resolve_save_target(&link, Some(&src)), Err(FileError::SameAsSource));
    }

    #[test]
    fn atomic_write_replaces_and_cleans_up() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("out.pdf");
        fs::write(&target, b"old").unwrap();
        write_atomic(&target, &pdf_bytes()).unwrap();
        assert_eq!(fs::read(&target).unwrap(), pdf_bytes());
        let leftovers: Vec<_> = fs::read_dir(dir.path()).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().ends_with(".tmp")).collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn grants_persist_and_are_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("data").join("recent-files.json");
        let g = Grants::load(store.clone());
        for i in 0..(MAX_GRANTS + 5) {
            g.grant_opened(&dir.path().join(format!("{i}.pdf")));
        }
        let reloaded = Grants::load(store.clone());
        assert!(reloaded.is_opened(&dir.path().join(format!("{}.pdf", MAX_GRANTS + 4))));
        assert!(!reloaded.is_opened(&dir.path().join("0.pdf")));
        reloaded.forget(None);
        assert!(!Grants::load(store).is_opened(&dir.path().join(format!("{}.pdf", MAX_GRANTS + 4))));
    }

    #[test]
    fn error_codes_match_frontend() {
        let s: String = FileError::SameAsSource.into();
        assert!(s.starts_with("same-as-source: "));
        let s: String = FileError::NotPdf("x".into()).into();
        assert_eq!(s, "not-pdf: x");
    }
}
