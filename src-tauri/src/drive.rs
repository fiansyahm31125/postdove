use crate::online::{
    GoogleLogin, MAX_BYTES, client, decode_snapshot, google_client_id, loopback_request,
    random_token, read_body, read_json,
};
use reqwest::{Client, Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    net::Ipv4Addr,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager, State};
use tokio::{io::AsyncWriteExt, net::TcpListener, sync::Mutex, time::timeout};

const FILES: &str = "https://www.googleapis.com/drive/v3/files";
const UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3/files";

#[derive(Default)]
pub struct DriveWrites(Mutex<()>);

#[derive(Deserialize)]
struct File {
    id: String,
}

#[derive(Deserialize)]
struct FileList {
    files: Vec<File>,
}

fn file_id(input: &str) -> Result<String, String> {
    let input = input.trim();
    let parsed;
    let id = if let Ok(url) = Url::parse(input) {
        if url.scheme() != "https" {
            return Err("Use an HTTPS PostDove invitation or Google Drive link.".into());
        }
        if url.origin().ascii_serialization() == "https://fiansyahm31125.github.io"
            && url.path() == "/postdove/share.html"
        {
            parsed = url
                .fragment()
                .and_then(|query| {
                    reqwest::Url::parse(&format!("https://localhost/?{query}"))
                        .ok()?
                        .query_pairs()
                        .find(|(key, _)| key == "file")
                        .map(|(_, value)| value.into_owned())
                })
                .unwrap_or_default();
        } else if url.origin().ascii_serialization() == "https://drive.google.com" {
            let segments = url
                .path_segments()
                .into_iter()
                .flatten()
                .collect::<Vec<_>>();
            parsed = if segments.len() >= 3 && segments[0] == "file" && segments[1] == "d" {
                segments[2].to_owned()
            } else if url.path() == "/open" {
                url.query_pairs()
                    .find(|(key, _)| key == "id")
                    .map(|(_, value)| value.into_owned())
                    .unwrap_or_default()
            } else {
                String::new()
            };
        } else {
            return Err("Use a PostDove invitation or a drive.google.com file link.".into());
        }
        &parsed
    } else {
        input
    };
    if !(8..=160).contains(&id.len())
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
    {
        return Err("The link does not contain a valid Google Drive file ID.".into());
    }
    Ok(id.to_owned())
}

async fn find_file(http: &Client, token: &str, query: &str) -> Result<Option<File>, String> {
    let response = http
        .get(FILES)
        .bearer_auth(token)
        .query(&[
            ("q", query),
            ("fields", "files(id)"),
            ("pageSize", "2"),
            ("orderBy", "createdTime"),
        ])
        .send()
        .await
        .map_err(|_| "Could not connect to Google Drive.")?;
    let list: FileList = read_json(response, 32_000).await?;
    Ok(list.files.into_iter().next())
}

async fn root_folder(http: &Client, token: &str) -> Result<String, String> {
    let query = "trashed = false and 'root' in parents and 'me' in owners and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='postdove' and value='root-v1' }";
    if let Some(folder) = find_file(http, token, query).await? {
        return Ok(folder.id);
    }
    let response = http
        .post(FILES)
        .bearer_auth(token)
        .query(&[("fields", "id")])
        .json(&json!({
            "name": "PostDove",
            "mimeType": "application/vnd.google-apps.folder",
            "parents": ["root"],
            "appProperties": { "postdove": "root-v1" }
        }))
        .send()
        .await
        .map_err(|_| "Could not create My Drive/PostDove.")?;
    Ok(read_json::<File>(response, 32_000).await?.id)
}

async fn publish_pairing(
    http: &Client,
    token: &str,
    mut snapshot: Value,
    key: &str,
    previous: Option<&str>,
) -> Result<String, String> {
    snapshot["format"] = json!("postdove-drive-v1");
    let content = serde_json::to_vec(&snapshot).map_err(|_| "Could not encode the snapshot.")?;
    if content.len() > MAX_BYTES {
        return Err("This folder snapshot exceeds the size limit.".into());
    }
    let mut metadata = json!({
        "name": "Shared collections.json",
        "mimeType": "application/json",
        "appProperties": {"postdovePairing":key}
    });
    let (method, endpoint) = match previous {
        Some(id) => (Method::PATCH, format!("{UPLOAD}/{}", file_id(id)?)),
        None => {
            metadata["parents"] = json!([root_folder(http, token).await?]);
            (Method::POST, UPLOAD.to_owned())
        }
    };
    let mut entropy = [0u8; 16];
    getrandom::fill(&mut entropy).map_err(|_| "Could not prepare the upload.")?;
    let boundary = format!("postdove_{:x}", u128::from_be_bytes(entropy));
    let mut body = format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/json\r\n\r\n").into_bytes();
    body.extend_from_slice(&content);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let response = http
        .request(method, endpoint)
        .bearer_auth(token)
        .query(&[("uploadType", "multipart"), ("fields", "id")])
        .header(
            "Content-Type",
            format!("multipart/related; boundary={boundary}"),
        )
        .body(body)
        .send()
        .await
        .map_err(|_| "Could not publish the folder to Google Drive.")?;
    file_id(&read_json::<File>(response, 32_000).await?.id)
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlinePairing {
    email: String,
    folder_ids: Vec<String>,
    file_id: String,
}

async fn pairing_directory(
    app: &AppHandle,
    firebase: &crate::firebase::Firebase,
) -> Result<(PathBuf, String), String> {
    let (uid, email) = firebase.account().await?;
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("online-pairings")
        .join(format!("{:x}", Sha256::digest(uid)));
    Ok((directory, email))
}

fn pairing_file(directory: &Path, email: &str) -> PathBuf {
    directory.join(format!("{:x}.json", Sha256::digest(email)))
}

fn lock_pairing(path: &Path) -> Result<std::fs::File, String> {
    let directory = path
        .parent()
        .ok_or("Online pairing directory is missing.")?;
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(path.with_extension("lock"))
        .map_err(|error| error.to_string())?;
    lock.try_lock()
        .map_err(|_| "This online pairing is being changed in another PostDove window.")?;
    Ok(lock)
}

fn read_pairing(path: &Path) -> Result<Option<OnlinePairing>, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub async fn drive_pairings(
    app: AppHandle,
    writes: State<'_, DriveWrites>,
    firebase: State<'_, crate::firebase::Firebase>,
) -> Result<Vec<OnlinePairing>, String> {
    let _guard = writes.0.lock().await;
    let (directory, _) = pairing_directory(&app, &firebase).await?;
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(error.to_string()),
    };
    let mut pairings = Vec::new();
    for entry in entries {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path
            .extension()
            .is_some_and(|extension| extension == "json")
        {
            if let Some(pairing) = read_pairing(&path)? {
                pairings.push(pairing);
            }
        }
    }
    pairings.sort_by(|a, b| a.email.cmp(&b.email));
    Ok(pairings)
}

#[tauri::command]
pub async fn drive_share_enabled(
    app: AppHandle,
    login: State<'_, GoogleLogin>,
    writes: State<'_, DriveWrites>,
    firebase: State<'_, crate::firebase::Firebase>,
    email: String,
    workspace: Value,
) -> Result<Option<String>, String> {
    let _guard = writes.0.lock().await;
    let email = email.trim().to_lowercase();
    let (directory, sender) = pairing_directory(&app, &firebase).await?;
    if email == sender
        || email.len() > 254
        || !email.split_once('@').is_some_and(|(name, domain)| {
            !name.is_empty()
                && domain.contains('.')
                && !domain.contains('@')
                && !email.chars().any(char::is_whitespace)
        })
    {
        return Err("Enter another Google account’s email address.".into());
    }
    let path = pairing_file(&directory, &email);
    let _pairing_lock = lock_pairing(&path)?;
    let previous = read_pairing(&path)?;
    let snapshot = crate::lan::public_snapshot(&workspace, |folder| folder["lanShared"] == true);
    let enabled: Vec<String> = snapshot["folders"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|folder| folder["id"].as_str().map(str::to_owned))
        .collect();
    if enabled.is_empty() {
        return Err("Turn on at least one collection before sharing.".into());
    }
    if previous
        .as_ref()
        .is_some_and(|pairing| pairing.folder_ids.iter().any(|id| !enabled.contains(id)))
    {
        return Err("Restore the previously shared collections before updating this pairing, or disconnect it.".into());
    }
    let token = login.drive_token().await?;
    let http = client()?;
    let key = format!("{:x}", Sha256::digest(email.as_bytes()));
    // Persist the expanded lock before updating a file that may already be shared.
    if let Some(pairing) = &previous {
        crate::write_json(
            &path,
            &OnlinePairing {
                email: email.clone(),
                folder_ids: enabled.clone(),
                file_id: pairing.file_id.clone(),
            },
        )?;
    }
    let id = publish_pairing(
        &http,
        &token,
        snapshot,
        &key,
        previous.as_ref().map(|p| p.file_id.as_str()),
    )
    .await?;
    if previous.is_none() {
        crate::write_json(
            &path,
            &OnlinePairing {
                email: email.clone(),
                folder_ids: enabled,
                file_id: id.clone(),
            },
        )?;
    }

    if viewer_permissions(&http, &token, &id, &email)
        .await?
        .is_empty()
    {
        let response = http
            .post(format!("{FILES}/{id}/permissions"))
            .bearer_auth(&token)
            .query(&[("fields", "id"), ("sendNotificationEmail", "false")])
            .json(&json!({"type":"user","role":"reader","emailAddress":email}))
            .send()
            .await
            .map_err(|_| "Could not grant Viewer access.")?;
        let _: Value = read_json(response, 32_000).await?;
    }
    Ok(crate::firebase::notify(&firebase, &email, &id).await.err())
}

async fn viewer_permissions(
    http: &Client,
    token: &str,
    id: &str,
    email: &str,
) -> Result<Vec<String>, String> {
    let mut page = None;
    let mut matches = Vec::new();
    loop {
        let request = http
            .get(format!("{FILES}/{id}/permissions"))
            .bearer_auth(token)
            .query(&[(
                "fields",
                "nextPageToken,permissions(id,type,role,emailAddress)",
            )]);
        let request = match &page {
            Some(page) => request.query(&[("pageToken", page)]),
            None => request,
        };
        let response = request
            .send()
            .await
            .map_err(|_| "Could not check Viewer access.")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Err("The shared snapshot could not be found in your Google Drive.".into());
        }
        let data: Value = read_json(response, 100_000).await?;
        for permission in data["permissions"].as_array().into_iter().flatten() {
            if permission["type"] == "user"
                && permission["role"] == "reader"
                && permission["emailAddress"]
                    .as_str()
                    .is_some_and(|address| address.eq_ignore_ascii_case(email))
            {
                if let Some(id) = permission["id"].as_str() {
                    matches.push(id.to_owned());
                }
            }
        }
        page = data["nextPageToken"].as_str().map(str::to_owned);
        if page.is_none() {
            return Ok(matches);
        }
    }
}

#[tauri::command]
pub async fn drive_disconnect_pairing(
    app: AppHandle,
    login: State<'_, GoogleLogin>,
    writes: State<'_, DriveWrites>,
    firebase: State<'_, crate::firebase::Firebase>,
    email: String,
) -> Result<(), String> {
    let _guard = writes.0.lock().await;
    let (directory, _) = pairing_directory(&app, &firebase).await?;
    let path = pairing_file(&directory, &email);
    let _pairing_lock = lock_pairing(&path)?;
    let pairing = read_pairing(&path)?.ok_or("This online pairing is no longer active.")?;
    let token = login.drive_token().await?;
    let http = client()?;
    let id = file_id(&pairing.file_id)?;
    let endpoint =
        Url::parse(&format!("{FILES}/{id}/permissions")).map_err(|error| error.to_string())?;
    let response = http
        .get(format!("{FILES}/{id}"))
        .bearer_auth(&token)
        .query(&[("fields", "id")])
        .send()
        .await
        .map_err(|_| "Could not check the shared snapshot.")?;
    if response.status() != StatusCode::NOT_FOUND {
        let _: File = read_json(response, 32_000).await?;
        for permission in viewer_permissions(&http, &token, &id, &pairing.email).await? {
            let mut url = endpoint.clone();
            url.path_segments_mut()
                .map_err(|_| "Invalid Drive permissions URL.")?
                .push(&permission);
            let response = http
                .delete(url)
                .bearer_auth(&token)
                .send()
                .await
                .map_err(|_| "Could not remove Viewer access.")?;
            if response.status() != StatusCode::NOT_FOUND && !response.status().is_success() {
                return Err(format!(
                    "Could not remove Viewer access (HTTP {}).",
                    response.status()
                ));
            }
        }
    }
    crate::firebase::withdraw(&firebase, &pairing.email, &id).await?;
    std::fs::remove_file(path).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn drive_read(login: State<'_, GoogleLogin>, link: String) -> Result<Value, String> {
    let token = login.drive_token().await?;
    let id = file_id(&link)?;
    read_snapshot(&token, &id).await
}

async fn read_snapshot(token: &str, id: &str) -> Result<Value, String> {
    let response = client()?
        .get(format!("{FILES}/{id}"))
        .bearer_auth(token)
        .query(&[("alt", "media")])
        .send()
        .await
        .map_err(|_| "Could not read the Drive snapshot.")?;
    if matches!(
        response.status(),
        StatusCode::NOT_FOUND | StatusCode::FORBIDDEN
    ) {
        return Err("Drive did not grant PostDove access to this file. Open it in Drive with the invited account, download the JSON, then import it here.".into());
    }
    decode_snapshot(&read_body(response, MAX_BYTES).await?)
}

fn picker_config() -> Option<(String, String)> {
    let key = std::env::var("POSTDOVE_GOOGLE_PICKER_KEY")
        .ok()
        .or_else(|| option_env!("POSTDOVE_GOOGLE_PICKER_KEY").map(str::to_owned))?;
    let project = google_client_id()?.split_once('-')?.0.to_owned();
    (!key.trim().is_empty()
        && !project.is_empty()
        && project.bytes().all(|byte| byte.is_ascii_digit()))
    .then_some((key, project))
}

#[tauri::command]
pub fn drive_picker_configured() -> bool {
    picker_config().is_some()
}

#[tauri::command]
pub async fn drive_pick(login: State<'_, GoogleLogin>) -> Result<Option<Value>, String> {
    let (key, project) =
        picker_config().ok_or("Google Picker is not configured for this build.")?;
    let token = login.drive_token().await?;
    let nonce = random_token()?;
    let page_path = format!("/picker/{nonce}");
    let result_path = format!("/selected/{nonce}");
    let data =
        json!({"developerKey":key, "appId":project, "accessToken":token, "resultPath":result_path})
            .to_string()
            .replace('<', "\\u003c");
    let page = include_str!("drive-picker.html")
        .replace("{{NONCE}}", &nonce)
        .replace("{{CONFIG}}", &data);
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|_| "Could not open the local Google Picker.")?;
    let address = listener
        .local_addr()
        .map_err(|_| "Could not determine the local Picker address.")?;
    open::that_detached(format!("http://{address}{page_path}"))
        .map_err(|_| "Could not open Google Picker in the browser.")?;
    let selection = timeout(Duration::from_secs(180), async {
        loop {
            let (mut socket, _) = listener.accept().await.map_err(|_| "Could not receive the Picker result.")?;
            let url = loopback_request(&mut socket).await;
            let path = url.as_ref().map(Url::path);
            let is_result = path == Some(result_path.as_str());
            let is_page = path == Some(page_path.as_str());
            let id = if is_result { url.and_then(|url| {
                url.query_pairs().find(|(key, _)| key == "id").and_then(|(_, id)| file_id(&id).ok())
            }) } else { None };
            let (status, content_type, response) = if is_page {
                ("200 OK", "text/html", page.as_str())
            } else if is_result {
                ("200 OK", "text/plain", "Return to PostDove to see the selected folder.")
            } else {
                ("404 Not Found", "text/plain", "Not found.")
            };
            let reply = format!(
                "HTTP/1.1 {status}\r\nContent-Type: {content_type}; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; base-uri 'none'; frame-ancestors 'none'; script-src 'nonce-{nonce}' https://apis.google.com https://www.gstatic.com; frame-src https://docs.google.com https://apis.google.com; connect-src https://*.googleapis.com https://apis.google.com; style-src 'unsafe-inline'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{response}",
                response.len()
            );
            let _ = timeout(Duration::from_secs(2), socket.write_all(reply.as_bytes())).await;
            if is_result { return Ok::<_, &str>(id); }
        }
    }).await.map_err(|_| "Google Picker timed out. Try again.")??;
    match selection {
        Some(id) => read_snapshot(&token, &id).await.map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn drive_import() -> Result<Option<Value>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("PostDove snapshot", &["json"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    use std::io::Read;
    let mut bytes = Vec::new();
    std::fs::File::open(file.path())
        .map_err(|_| "Could not open the snapshot.")?
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read the snapshot.")?;
    decode_snapshot(&bytes).map(Some)
}

#[tauri::command]
pub fn drive_open_in_browser(link: String) -> Result<(), String> {
    let id = file_id(&link)?;
    open::that_detached(format!("https://drive.google.com/file/d/{id}/view"))
        .map_err(|_| "Could not open Google Drive in the browser.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drive_links_only_accept_the_expected_hosts_and_a_valid_id() {
        let id = "12345678-Abc_x";
        assert_eq!(file_id(id).unwrap(), id);
        assert_eq!(
            file_id(&format!("https://drive.google.com/file/d/{id}/view")).unwrap(),
            id
        );
        assert_eq!(
            file_id(&format!(
                "https://fiansyahm31125.github.io/postdove/share.html#file={id}"
            ))
            .unwrap(),
            id
        );
        for invalid in [
            "https://drive.google.com.example/file/d/12345678/view",
            "http://drive.google.com/file/d/12345678/view",
            "https://drive.google.com/file/d/12345678%2Fextra/view",
            "../snapshots",
        ] {
            assert!(file_id(invalid).is_err());
        }
    }

    #[test]
    fn imported_snapshot_returns_only_the_published_read_only_shape() {
        let file = json!({
            "format":"postdove-drive-v1",
            "folders":[{"id":"visible","name":"Shared","env":"private-value"}],
            "requests":[{
                "id":"r","name":"Sample","folderId":"visible","method":"GET",
                "url":"https://user:secret@example.com/test?key=private-value",
                "headers":["Accept"],"parameters":["key"],
                "bodyContent":"private-value"
            },{
                "id":"other","name":"Private folder request","folderId":"other","method":"GET"
            }]
        });
        let public = decode_snapshot(&serde_json::to_vec(&file).unwrap()).unwrap();
        assert_eq!(public["requests"].as_array().unwrap().len(), 1);
        assert_eq!(public["requests"][0]["url"], "https://example.com/test");
        assert_eq!(public["requests"][0]["headers"], json!(["Accept"]));
        assert!(!public.to_string().contains("private-value"));
    }
}
