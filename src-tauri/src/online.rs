use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::{Client, Response, Url};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    net::Ipv4Addr,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::Mutex,
    time::timeout,
};

pub(crate) const MAX_BYTES: usize = 750_000;

pub(crate) fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("PostDove")
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Could not start the HTTPS client.".into())
}

pub(crate) async fn read_body(mut response: Response, limit: usize) -> Result<Vec<u8>, String> {
    if !response.status().is_success() {
        return Err(format!(
            "The service returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read the HTTPS response.")?
    {
        if chunk.len() > limit.saturating_sub(bytes.len()) {
            return Err("The response is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub(crate) async fn read_json<T: DeserializeOwned>(
    response: Response,
    limit: usize,
) -> Result<T, String> {
    let bytes = read_body(response, limit).await?;
    serde_json::from_slice(&bytes).map_err(|_| "The service returned invalid JSON.".into())
}

pub(crate) fn decode_snapshot(bytes: &[u8]) -> Result<Value, String> {
    let mut snapshot: Value =
        serde_json::from_slice(bytes).map_err(|_| "Snapshot JSON is invalid.")?;
    if bytes.len() > MAX_BYTES
        || snapshot["format"] != "postdove-drive-v1"
        || snapshot["folders"].as_array().map(Vec::len) != Some(1)
        || !snapshot["requests"].is_array()
    {
        return Err("The file is not a supported PostDove snapshot.".into());
    }
    for request in snapshot["requests"].as_array_mut().unwrap() {
        if !request.is_object() {
            continue;
        }
        let names = |field: &str| {
            request[field]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(|name| json!({"key":name,"enabled":true}))
                .collect::<Vec<_>>()
        };
        let headers = names("headers");
        let parameters = names("parameters");
        request["headers"] = json!(headers);
        request["params"] = json!(parameters);
    }
    // Rebuild the allowlisted shape before returning repository content to the UI.
    Ok(crate::lan::public_snapshot(&snapshot, |_| true))
}

#[derive(Default)]
pub struct GoogleLogin {
    signing_in: Mutex<()>,
    drive: Mutex<Option<DriveSession>>,
    profile: Mutex<Option<GoogleProfile>>,
}

struct DriveSession {
    token: String,
    expires: Instant,
}

impl GoogleLogin {
    pub(crate) async fn drive_token(&self) -> Result<String, String> {
        self.drive
            .lock()
            .await
            .as_ref()
            .filter(|session| session.expires > Instant::now())
            .map(|session| session.token.clone())
            .ok_or_else(|| {
                "Connect your Google Drive account first. Expired sessions can be reconnected."
                    .into()
            })
    }
}

#[tauri::command]
pub async fn google_drive_connected(login: State<'_, GoogleLogin>) -> Result<bool, String> {
    Ok(login.drive_token().await.is_ok())
}

#[derive(Clone, Deserialize, Serialize)]
pub struct GoogleProfile {
    sub: String,
    name: Option<String>,
    email: String,
    email_verified: bool,
}

#[tauri::command]
pub async fn google_profile(
    login: State<'_, GoogleLogin>,
) -> Result<Option<GoogleProfile>, String> {
    Ok(login.profile.lock().await.clone())
}

#[tauri::command]
pub async fn google_logout(
    app: AppHandle,
    login: State<'_, GoogleLogin>,
    firebase: State<'_, crate::firebase::Firebase>,
) -> Result<(), String> {
    let _lock = login
        .signing_in
        .try_lock()
        .map_err(|_| "Wait for the current sign-in to finish.")?;
    crate::lan::lan_host_stop(app.state::<std::sync::Arc<crate::lan::Lan>>()).await?;
    *login.drive.lock().await = None;
    *login.profile.lock().await = None;
    firebase.clear().await;
    Ok(())
}

pub(crate) fn random_token() -> Result<String, String> {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).map_err(|_| "Could not create a secure sign-in request.")?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

pub(crate) async fn loopback_request(socket: &mut TcpStream) -> Option<Url> {
    timeout(Duration::from_secs(2), async {
        let mut headers = Vec::new();
        let mut chunk = [0; 1024];
        while !headers.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            let count = socket.read(&mut chunk).await.ok()?;
            if count == 0 || headers.len() + count > 8192 {
                return None;
            }
            headers.extend_from_slice(&chunk[..count]);
        }
        let line = std::str::from_utf8(&headers).ok()?.lines().next()?;
        let mut words = line.split_whitespace();
        if words.next()? != "GET" {
            return None;
        }
        let path = words.next()?;
        if !path.starts_with('/') || path.starts_with("//") {
            return None;
        }
        Url::parse(&format!("http://127.0.0.1{path}")).ok()
    })
    .await
    .ok()
    .flatten()
}

pub(crate) fn google_client_id() -> Option<String> {
    std::env::var("POSTDOVE_GOOGLE_CLIENT_ID")
        .ok()
        .or_else(|| option_env!("POSTDOVE_GOOGLE_CLIENT_ID").map(str::to_owned))
}

async fn callback(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    loop {
        let (mut socket, _) = listener
            .accept()
            .await
            .map_err(|_| "Could not accept the sign-in callback.")?;
        let query = loopback_request(&mut socket).await.and_then(|url| {
            if url.path() != "/oauth/google" {
                return None;
            }
            let fields = url
                .query_pairs()
                .into_owned()
                .collect::<std::collections::HashMap<_, _>>();
            (fields.get("state").map(String::as_str) == Some(expected_state)).then_some(fields)
        });
        let (status, message) = if query.is_some() {
            ("200 OK", "Return to PostDove to see your sign-in result.")
        } else {
            (
                "400 Bad Request",
                "This is not the active PostDove sign-in callback.",
            )
        };
        let reply = format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{message}",
            message.len()
        );
        let _ = timeout(Duration::from_secs(2), socket.write_all(reply.as_bytes())).await;
        if let Some(mut fields) = query {
            return fields
                .remove("code")
                .ok_or("Google sign-in was cancelled or denied.".into());
        }
    }
}

#[tauri::command]
pub async fn google_login(
    login: State<'_, GoogleLogin>,
    firebase: State<'_, crate::firebase::Firebase>,
    drive: Option<bool>,
) -> Result<GoogleProfile, String> {
    let _lock = login
        .signing_in
        .try_lock()
        .map_err(|_| "A Google sign-in is already in progress.")?;
    crate::firebase::ensure_configured()?;
    let config = |name, embedded| std::env::var(name).ok().or(embedded);
    let id = google_client_id()
        .ok_or("Google sign-in is not configured. Set POSTDOVE_GOOGLE_CLIENT_ID for a Google Desktop OAuth client.")?;
    let secret = config(
        "POSTDOVE_GOOGLE_CLIENT_SECRET",
        option_env!("POSTDOVE_GOOGLE_CLIENT_SECRET").map(str::to_owned),
    );
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|_| "Could not open the local sign-in callback.")?;
    let redirect = format!(
        "http://127.0.0.1:{}/oauth/google",
        listener
            .local_addr()
            .map_err(|error| error.to_string())?
            .port()
    );
    let state = random_token()?;
    let verifier = random_token()?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    let needs_drive = drive.unwrap_or(false);
    let scope = if needs_drive {
        "openid email profile https://www.googleapis.com/auth/drive.file"
    } else {
        "openid email profile"
    };
    url.query_pairs_mut().extend_pairs([
        ("client_id", id.as_str()),
        ("redirect_uri", &redirect),
        ("response_type", "code"),
        ("scope", scope),
        ("state", &state),
        ("code_challenge", &challenge),
        ("code_challenge_method", "S256"),
        ("prompt", "select_account"),
    ]);
    open::that_detached(url.as_str())
        .map_err(|_| "Could not open the browser for Google sign-in.")?;
    let code = timeout(Duration::from_secs(180), callback(listener, &state))
        .await
        .map_err(|_| "Google sign-in expired. Try again.")??;
    let mut form = vec![
        ("client_id", id),
        ("redirect_uri", redirect),
        ("grant_type", "authorization_code".into()),
        ("code", code),
        ("code_verifier", verifier),
    ];
    if let Some(secret) = secret {
        form.push(("client_secret", secret));
    }
    let http = client()?;
    let response = http
        .post("https://oauth2.googleapis.com/token")
        .form(&form)
        .send()
        .await
        .map_err(|_| "Could not exchange the Google sign-in code.")?;
    let token: Value = read_json(response, 32_000).await?;
    let access = token["access_token"]
        .as_str()
        .ok_or("Google did not return an access token.")?;
    let response = http
        .get("https://openidconnect.googleapis.com/v1/userinfo")
        .bearer_auth(access)
        .send()
        .await
        .map_err(|_| "Could not retrieve the Google profile.")?;
    let profile: GoogleProfile = read_json(response, 32_000).await?;
    if !profile.email_verified || profile.email.is_empty() || profile.sub.is_empty() {
        return Err("Google did not return a verified account.".into());
    }
    if needs_drive
        && !token["scope"]
            .as_str()
            .unwrap_or_default()
            .split_whitespace()
            .any(|scope| scope == "https://www.googleapis.com/auth/drive.file")
    {
        return Err(
            "Google Drive permission was declined. Connect again and allow access to app files."
                .into(),
        );
    }
    firebase
        .authenticate(
            token["id_token"]
                .as_str()
                .ok_or("Google did not return an identity token.")?,
            &profile.email,
            needs_drive,
        )
        .await?;
    *login.profile.lock().await = Some(profile.clone());
    *login.drive.lock().await = needs_drive.then(|| DriveSession {
        token: access.to_owned(),
        expires: Instant::now()
            + Duration::from_secs(
                token["expires_in"]
                    .as_u64()
                    .unwrap_or(3600)
                    .clamp(1, 3600)
                    .saturating_sub(15),
            ),
    });
    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn google_callback_ignores_invalid_state_and_returns_the_expected_code() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let callback = tokio::spawn(callback(listener, "expected"));
        for (state, status) in [("wrong", "400"), ("expected", "200")] {
            let mut socket = TcpStream::connect(address).await.unwrap();
            socket.write_all(format!("GET /oauth/google?state={state}&code=example HTTP/1.1\r\nHost: localhost\r\n\r\n").as_bytes()).await.unwrap();
            let mut reply = String::new();
            socket.read_to_string(&mut reply).await.unwrap();
            assert!(reply.starts_with(&format!("HTTP/1.1 {status}")));
        }
        assert_eq!(callback.await.unwrap().unwrap(), "example");
    }
}
