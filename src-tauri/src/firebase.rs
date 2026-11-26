use crate::online::{client, read_json};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tauri::State;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct Firebase {
    session: Mutex<Option<Session>>,
    signed_in: AtomicBool,
}

pub(crate) struct Session {
    uid: String,
    email: String,
    id_token: String,
    refresh_token: String,
    expires: Instant,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignIn {
    local_id: String,
    email: String,
    email_verified: bool,
    id_token: String,
    refresh_token: String,
    expires_in: String,
}

fn config() -> Result<(String, String), String> {
    let key = std::env::var("POSTDOVE_FIREBASE_API_KEY")
        .ok()
        .or_else(|| option_env!("POSTDOVE_FIREBASE_API_KEY").map(str::to_owned));
    let project = std::env::var("POSTDOVE_FIREBASE_PROJECT_ID")
        .ok()
        .or_else(|| option_env!("POSTDOVE_FIREBASE_PROJECT_ID").map(str::to_owned));
    match (key, project) {
        (Some(key), Some(project)) if !key.is_empty() && !project.is_empty()
            && project.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') => Ok((key, project)),
        _ => Err("Firebase is not configured. Set POSTDOVE_FIREBASE_API_KEY and POSTDOVE_FIREBASE_PROJECT_ID.".into()),
    }
}

pub(crate) fn ensure_configured() -> Result<(), String> {
    config().map(|_| ())
}

fn expiry(value: &str) -> Instant {
    Instant::now()
        + Duration::from_secs(
            value
                .parse::<u64>()
                .unwrap_or(3600)
                .clamp(1, 3600)
                .saturating_sub(60),
        )
}

impl Firebase {
    pub(crate) fn signed_in(&self) -> bool {
        self.signed_in.load(Ordering::Acquire)
    }

    pub(crate) async fn clear(&self) {
        self.signed_in.store(false, Ordering::Release);
        *self.session.lock().await = None;
        self.signed_in.store(false, Ordering::Release);
    }

    pub(crate) async fn authenticate(
        &self,
        google_id_token: &str,
        email: &str,
        connecting_drive: bool,
    ) -> Result<(), String> {
        let (key, _) = config()?;
        let mut active = self.session.lock().await;
        if connecting_drive
            && active
                .as_ref()
                .is_none_or(|s| !s.email.eq_ignore_ascii_case(email))
        {
            return Err("Connect Google Drive using the same Google account you used to sign in to PostDove.".into());
        }
        let body = Url::parse("https://localhost/")
            .unwrap()
            .query_pairs_mut()
            .append_pair("id_token", google_id_token)
            .append_pair("providerId", "google.com")
            .finish()
            .query()
            .unwrap()
            .to_owned();
        let response = client()?
            .post("https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp")
            .query(&[("key", key)])
            .json(&json!({
                "postBody": body, "requestUri": "http://localhost", "returnSecureToken": true
            }))
            .send()
            .await
            .map_err(|_| "Could not contact Firebase Authentication.")?;
        let signed: SignIn = read_json(response, 100_000)
            .await
            .map_err(|error| format!("Firebase sign-in failed: {error}"))?;
        if !signed.email_verified
            || !signed.email.eq_ignore_ascii_case(email)
            || signed.local_id.is_empty()
        {
            return Err("Firebase did not verify this Google account.".into());
        }
        *active = Some(Session {
            uid: signed.local_id,
            email: signed.email.to_lowercase(),
            id_token: signed.id_token,
            refresh_token: signed.refresh_token,
            expires: expiry(&signed.expires_in),
        });
        self.signed_in.store(true, Ordering::Release);
        Ok(())
    }

    pub(crate) async fn account(&self) -> Result<(String, String), String> {
        let active = self.session.lock().await;
        let session = active.as_ref().ok_or("Sign in to PostDove first.")?;
        Ok((session.uid.clone(), session.email.clone()))
    }

    async fn credentials(&self) -> Result<(String, String, String), String> {
        let mut active = self.session.lock().await;
        let session = active.as_mut().ok_or("Sign in to PostDove first.")?;
        if session.expires <= Instant::now() {
            let (key, _) = config()?;
            let response = client()?
                .post("https://securetoken.googleapis.com/v1/token")
                .query(&[("key", key)])
                .form(&[
                    ("grant_type", "refresh_token"),
                    ("refresh_token", &session.refresh_token),
                ])
                .send()
                .await
                .map_err(|_| "Could not refresh the Firebase session.")?;
            let value: Value = read_json(response, 100_000).await?;
            let id = value["id_token"]
                .as_str()
                .ok_or("Firebase did not return a session token.")?;
            let refresh = value["refresh_token"]
                .as_str()
                .ok_or("Firebase did not return a refresh token.")?;
            session.id_token = id.to_owned();
            session.refresh_token = refresh.to_owned();
            session.expires = expiry(value["expires_in"].as_str().unwrap_or("3600"));
        }
        Ok((
            session.uid.clone(),
            session.email.clone(),
            session.id_token.clone(),
        ))
    }
}

fn endpoint() -> Result<String, String> {
    let (_, project) = config()?;
    Ok(format!(
        "https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents"
    ))
}

#[derive(Serialize)]
pub struct Invitation {
    id: String,
    sender: String,
    link: String,
    created_at: String,
    accepted: bool,
}

fn invitation_id(uid: &str, recipient: &str, file: &str) -> String {
    format!("{:x}", Sha256::digest(format!("{uid}:{recipient}:{file}")))
}

pub(crate) async fn withdraw(firebase: &Firebase, recipient: &str, file: &str) -> Result<(), String> {
    let (uid, _, token) = firebase.credentials().await?;
    let response = client()?
        .delete(invitation_path(&invitation_id(&uid, recipient, file))?)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "Could not withdraw the PostDove invitation.")?;
    if response.status().is_success() || response.status() == reqwest::StatusCode::NOT_FOUND {
        Ok(())
    } else {
        Err("Drive access was removed, but the PostDove invitation could not be withdrawn.".into())
    }
}

pub(crate) async fn notify(firebase: &Firebase, recipient: &str, file: &str) -> Result<(), String> {
    let (uid, email, token) = firebase.credentials().await?;
    let recipient = recipient.trim().to_lowercase();
    let link = format!("https://drive.google.com/file/d/{file}/view");
    let id = invitation_id(&uid, &recipient, file);
    let response = client()?
        .post(format!("{}/invitations", endpoint()?))
        .query(&[("documentId", id)])
        .bearer_auth(token)
        .json(&json!({"fields":{
            "senderUid":{"stringValue":uid},
            "sender":{"stringValue":email},
            "recipient":{"stringValue":recipient},
            "link":{"stringValue":link}
        }}))
        .send()
        .await
        .map_err(|_| "Could not send the PostDove notification.")?;
    if response.status() == reqwest::StatusCode::CONFLICT {
        return Ok(());
    }
    let _: Value = read_json(response, 100_000).await?;
    Ok(())
}

#[tauri::command]
pub async fn firebase_invitations(
    firebase: State<'_, Firebase>,
) -> Result<Vec<Invitation>, String> {
    let (_, recipient, token) = firebase.credentials().await?;
    let response = client()?.post(format!("{}:runQuery", endpoint()?)).bearer_auth(token)
        .json(&json!({"structuredQuery":{
            "from":[{"collectionId":"invitations"}],
            "where":{"fieldFilter":{"field":{"fieldPath":"recipient"},"op":"EQUAL","value":{"stringValue":recipient}}},
            "limit":50
        }})).send().await.map_err(|_| "Could not load PostDove invitations.")?;
    let rows: Vec<Value> = read_json(response, 400_000).await?;
    let mut invitations: Vec<_> = rows
        .iter()
        .filter_map(|row| {
            let doc = &row["document"];
            Some(Invitation {
                id: doc["name"].as_str()?.rsplit('/').next()?.to_owned(),
                sender: doc["fields"]["sender"]["stringValue"].as_str()?.to_owned(),
                link: doc["fields"]["link"]["stringValue"].as_str()?.to_owned(),
                created_at: doc["createTime"].as_str()?.to_owned(),
                accepted: doc["fields"]["accepted"]["booleanValue"]
                    .as_bool()
                    .unwrap_or(false),
            })
        })
        .collect();
    invitations.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(invitations)
}

fn invitation_path(id: &str) -> Result<String, String> {
    if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid invitation ID.".into());
    }
    Ok(format!("{}/invitations/{id}", endpoint()?))
}

#[tauri::command]
pub async fn firebase_accept(firebase: State<'_, Firebase>, id: String) -> Result<(), String> {
    let path = invitation_path(&id)?;
    let (_, _, token) = firebase.credentials().await?;
    let response = client()?
        .patch(path)
        .query(&[
            ("updateMask.fieldPaths", "accepted"),
            ("currentDocument.exists", "true"),
        ])
        .bearer_auth(token)
        .json(&json!({"fields":{"accepted":{"booleanValue":true}}}))
        .send()
        .await
        .map_err(|_| "Could not accept the invitation.")?;
    let _: Value = read_json(response, 100_000).await?;
    Ok(())
}

#[tauri::command]
pub async fn firebase_dismiss(firebase: State<'_, Firebase>, id: String) -> Result<(), String> {
    let path = invitation_path(&id)?;
    let (_, _, token) = firebase.credentials().await?;
    let response = client()?
        .delete(path)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "Could not dismiss the invitation.")?;
    let _: Value = read_json(response, 100_000).await?;
    Ok(())
}
