#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod lan;
mod drive;
mod firebase;
mod online;

use postdove::studio::{Sandbox, StudioRequest, StudioResponse};
use postdove::{Request, Response, collection::Collection, postman, send};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

#[derive(Deserialize, Serialize)]
struct Workspace {
    collections: Vec<Collection>,
    requests: Vec<Request>,
}

impl Default for Workspace {
    fn default() -> Self {
        Self {
            collections: vec![Collection {
                name: "Local collection".into(),
                ..Default::default()
            }],
            requests: Vec::new(),
        }
    }
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("workspace.json"))
        .map_err(|error| error.to_string())
}

fn write_workspace(path: &Path, mut workspace: Workspace) -> Result<(), String> {
    for request in &mut workspace.requests {
        request.bearer.clear();
    }
    write_json(path, &workspace)
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("Workspace path has no parent directory.")?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut file, value).map_err(|error| error.to_string())?;
    file.as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    file.persist(path).map_err(|error| error.to_string())?;
    Ok(())
}

fn legacy_path() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        return std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .map(|path| path.join("Postdove/data/app.ron"));
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    if cfg!(target_os = "macos") {
        return home.map(|path| path.join("Library/Application Support/Postdove/app.ron"));
    }
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| home.map(|path| path.join(".local/share")))
        .map(|path| path.join("postdove/app.ron"))
}

fn read_legacy(path: &Path) -> Result<Workspace, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Workspace::default());
        }
        Err(error) => return Err(format!("Could not read legacy workspace: {error}")),
    };
    let values: HashMap<String, String> = ron::from_str(&text)
        .map_err(|error| format!("Could not read legacy workspace: {error}"))?;
    let mut workspace = Workspace::default();
    if let Some(collections) = values.get(postdove::collection::COLLECTIONS_KEY) {
        workspace.collections = ron::from_str(collections)
            .map_err(|error| format!("Could not read legacy collections: {error}"))?;
    }
    if let Some(requests) = values.get("saved_requests") {
        workspace.requests = ron::from_str(requests)
            .map_err(|error| format!("Could not read legacy requests: {error}"))?;
    }
    if workspace.collections.is_empty() {
        workspace.collections = Workspace::default().collections;
    }
    Ok(workspace)
}

#[tauri::command]
fn load_workspace(app: AppHandle) -> Result<Workspace, String> {
    match std::fs::read(path(&app)?) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("Could not read workspace: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            legacy_path().map_or_else(|| Ok(Workspace::default()), |path| read_legacy(&path))
        }
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn save_workspace(app: AppHandle, workspace: Workspace) -> Result<(), String> {
    write_workspace(&path(&app)?, workspace)
}

#[derive(Serialize)]
struct SentResponse {
    response: Response,
    expected_status: Option<u16>,
}

#[tauri::command]
async fn send_request(
    request: Request,
    collection: Collection,
    environment: Option<String>,
    bearer: String,
) -> Result<SentResponse, String> {
    let expected_status = collection.status_check()?;
    let request = collection.prepare(&request, environment.as_deref(), &bearer)?;
    Ok(SentResponse {
        response: send(request).await?,
        expected_status,
    })
}

#[derive(Serialize)]
struct Imported {
    collection: Collection,
    requests: Vec<Request>,
}

#[tauri::command]
async fn import_collection() -> Result<Option<Imported>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("Postman collection", &["json"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let text = std::fs::read_to_string(file.path()).map_err(|error| error.to_string())?;
    let (collection, requests) = postman::import(&text)?;
    Ok(Some(Imported {
        collection,
        requests,
    }))
}

#[tauri::command]
fn collection_json(collection: Collection, requests: Vec<Request>) -> Result<String, String> {
    let requests: Vec<_> = requests.iter().collect();
    postman::export(&collection, &requests)
}

#[tauri::command]
async fn export_collection(
    collection: Collection,
    requests: Vec<Request>,
) -> Result<Option<String>, String> {
    let stem: String = collection
        .name
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let json = collection_json(collection, requests)?;
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("Postman collection", &["json"])
        .set_file_name(format!("{stem}.postman_collection.json"))
        .save_file()
        .await
    else {
        return Ok(None);
    };
    std::fs::write(file.path(), json).map_err(|error| error.to_string())?;
    Ok(Some(file.path().display().to_string()))
}

fn studio_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(path(app)?.with_file_name("studio-workspace.json"))
}

#[tauri::command]
fn load_studio(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    match std::fs::read(studio_path(&app)?) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn save_studio(app: AppHandle, workspace: serde_json::Value) -> Result<(), String> {
    write_json(&studio_path(&app)?, &workspace)
}

#[tauri::command]
async fn execute_studio(
    sandbox: tauri::State<'_, Sandbox>,
    request: StudioRequest,
) -> Result<StudioResponse, String> {
    sandbox.execute(request).await
}

fn main() {
    let commands: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
        load_workspace, load_studio, save_studio, execute_studio,
        save_workspace, send_request, import_collection, export_collection, collection_json,
        lan::lan_status, lan::lan_host_start, lan::lan_host_stop, lan::lan_revoke,
        lan::lan_invite_info, lan::lan_pair, lan::lan_read, lan::lan_forget,
        drive::drive_publish, drive::drive_grant, drive::drive_read,
        drive::drive_pick, drive::drive_picker_configured, drive::drive_import,
        drive::drive_open_in_browser, online::google_drive_connected, online::google_login,
        online::google_profile, online::google_logout, firebase::firebase_invitations,
        firebase::firebase_accept, firebase::firebase_dismiss
    ];
    tauri::Builder::default()
        .manage(Sandbox::default())
        .manage(firebase::Firebase::default())
        .manage(online::GoogleLogin::default())
        .manage(drive::DriveWrites::default())
        .setup(|app| {
            let workspace = studio_path(app.handle()).map_err(std::io::Error::other)?;
            let directory = app.path().app_data_dir()?.join("lan");
            let lan = lan::Lan::load(directory, workspace).map_err(std::io::Error::other)?;
            app.manage(lan);
            Ok(())
        })
        .invoke_handler(move |call| {
            if call.message.command() != "google_login"
                && !call.message.webview_ref().state::<firebase::Firebase>().signed_in()
            {
                call.resolver.reject("Sign in to PostDove first.");
                return true;
            }
            commands(call)
        })
        .run(tauri::generate_context!())
        .expect("Could not start Postdove");
}
