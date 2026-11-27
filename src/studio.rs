use crate::{Request, send};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Mutex, time::Instant};
use time::{
    Duration, OffsetDateTime,
    format_description::well_known::{Rfc2822, Rfc3339},
};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultipartField {
    pub key: String,
    #[serde(default)]
    pub field_type: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub content_type: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioRequest {
    method: String,
    url: String,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    multipart: Option<Vec<MultipartField>>,
    #[serde(default)]
    binary_file: Option<String>,
}

pub fn guess_content_type(path: &str) -> &'static str {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    match ext.as_deref() {
        Some("json") => "application/json",
        Some("xml") => "application/xml",
        Some("txt") | Some("log") => "text/plain",
        Some("csv") => "text/csv",
        Some("html") | Some("htm") => "text/html",
        Some("pdf") => "application/pdf",
        Some("xls") => "application/vnd.ms-excel",
        Some("xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Some("doc") => "application/msword",
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("zip") => "application/zip",
        Some("mp3") => "audio/mpeg",
        Some("mp4") => "video/mp4",
        _ => "application/octet-stream",
    }
}

fn escape_disposition(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace(['\r', '\n'], "")
}

fn build_multipart_body(fields: &[MultipartField]) -> Result<(String, Vec<u8>), String> {
    let boundary = format!("----PostdoveBoundary{}", Uuid::new_v4().simple());
    let mut body = Vec::new();
    for field in fields {
        let key = field.key.trim();
        if key.is_empty() {
            continue;
        }
        let escaped_key = escape_disposition(key);
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        if field.field_type.eq_ignore_ascii_case("file") {
            let file_path = field.value.trim();
            if file_path.is_empty() {
                return Err(format!("No file selected for multipart field '{key}'."));
            }
            let bytes = std::fs::read(file_path).map_err(|error| {
                format!("Could not read file for field '{key}' ({file_path}): {error}")
            })?;
            let filename = std::path::Path::new(file_path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("file");
            let escaped_filename = escape_disposition(filename);
            let mime = if field.content_type.trim().is_empty() {
                guess_content_type(file_path)
            } else {
                field.content_type.trim()
            };
            body.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{escaped_key}\"; filename=\"{escaped_filename}\"\r\nContent-Type: {mime}\r\n\r\n"
                )
                .as_bytes(),
            );
            body.extend_from_slice(&bytes);
            body.extend_from_slice(b"\r\n");
        } else {
            body.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{escaped_key}\"\r\n").as_bytes(),
            );
            let ct = field.content_type.trim();
            if !ct.is_empty() {
                if ct.contains(['\r', '\n']) {
                    return Err(format!("Invalid Content-Type on field '{key}'."));
                }
                body.extend_from_slice(format!("Content-Type: {ct}\r\n").as_bytes());
            }
            body.extend_from_slice(b"\r\n");
            body.extend_from_slice(field.value.as_bytes());
            body.extend_from_slice(b"\r\n");
        }
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    Ok((format!("multipart/form-data; boundary={boundary}"), body))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioResponse {
    status: u16,
    status_text: String,
    headers: BTreeMap<String, String>,
    cookies: Vec<String>,
    body: String,
    size_bytes: usize,
    duration_ms: u128,
    final_url: String,
}

pub struct Sandbox {
    state: Mutex<SandboxState>,
}

struct SandboxState {
    transactions: Vec<Value>,
    policies: BTreeMap<String, Value>,
}

impl Default for Sandbox {
    fn default() -> Self {
        Self {
            state: Mutex::new(SandboxState {
                transactions: serde_json::from_str(include_str!("studio-fixtures.json"))
                    .expect("sandbox transaction fixtures"),
                policies: BTreeMap::from([(
                    "pol_eng_backend".into(),
                    json!({
                        "id": "pol_eng_backend", "name": "Backend Engineering Read/Write", "effect": "allow",
                        "scopes": ["payments:read", "payments:write", "webhooks:manage", "deployments:read"],
                        "updated_at": "2026-11-24T09:15:00Z", "updated_by": "usr_a91f0c"
                    }),
                )]),
            }),
        }
    }
}

impl Sandbox {
    pub async fn execute(&self, mut input: StudioRequest) -> Result<StudioResponse, String> {
        let started = Instant::now();
        let url = input.url.trim().to_owned();
        input.method = input.method.trim().to_ascii_uppercase();
        input.headers.retain(|name, _| {
            !matches!(
                name.trim().to_ascii_lowercase().as_str(),
                "" | "host" | "connection" | "content-length" | "transfer-encoding"
            )
        });
        let sandbox_url = if url.starts_with("/api/sandbox/") {
            Url::parse(&format!("http://sandbox.local{url}")).ok()
        } else {
            Url::parse(&url).ok().filter(|target| {
                target.host_str() == Some("sandbox.precisionslate.dev")
                    && target.path().starts_with("/api/sandbox/")
            })
        };
        if let Some(target) = sandbox_url {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "Could not open the local sandbox.")?;
            let mut reply = state.dispatch(&input, &target);
            reply.final_url = url;
            reply.duration_ms = started.elapsed().as_millis().max(1);
            return Ok(reply);
        }

        // The desktop app executes locally through the same HTTP engine as MCP.
        let mut body_bytes = None;
        if let Some(fields) = input.multipart.as_deref() {
            let (content_type, bytes) = build_multipart_body(fields)?;
            input
                .headers
                .retain(|name, _| !name.trim().eq_ignore_ascii_case("content-type"));
            input.headers.insert("Content-Type".into(), content_type);
            body_bytes = Some(bytes);
        } else if let Some(path) = input
            .binary_file
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let bytes = std::fs::read(path)
                .map_err(|error| format!("Could not read binary file ({path}): {error}"))?;
            let has_ct = input
                .headers
                .keys()
                .any(|name| name.trim().eq_ignore_ascii_case("content-type"));
            if !has_ct {
                input
                    .headers
                    .insert("Content-Type".into(), guess_content_type(path).into());
            }
            body_bytes = Some(bytes);
        }

        let mut headers = Vec::new();
        for (key, value) in input.headers {
            if key.contains(['\n', '\r', ':']) || value.contains(['\n', '\r']) {
                return Err("Invalid HTTP header.".into());
            }
            headers.push(format!("{key}: {value}"));
        }
        let result = send(Request {
            method: input.method,
            url: url.clone(),
            headers: headers.join("\n"),
            body: if body_bytes.is_some() {
                String::new()
            } else {
                input.body
            },
            body_bytes,
            ..Request::default()
        })
        .await?;
        let (status, status_text) = result
            .status
            .split_once(' ')
            .unwrap_or((&result.status, ""));
        let mut headers = BTreeMap::<String, String>::new();
        let mut cookies = Vec::new();
        for (name, value) in result
            .headers
            .lines()
            .filter_map(|line| line.split_once(": "))
        {
            if name.eq_ignore_ascii_case("set-cookie") {
                cookies.push(value.to_owned());
            } else {
                headers
                    .entry(name.to_owned())
                    .and_modify(|entry| {
                        entry.push_str(", ");
                        entry.push_str(value);
                    })
                    .or_insert_with(|| value.to_owned());
            }
        }
        if result.truncated {
            return Err("Response exceeded the 1 MiB inspection limit.".into());
        }
        Ok(StudioResponse {
            status: status.parse().map_err(|_| "Invalid HTTP status.")?,
            status_text: status_text.into(),
            headers,
            cookies,
            body: result.raw_body,
            size_bytes: result.bytes,
            duration_ms: result.elapsed_ms,
            final_url: url,
        })
    }
}

fn now(offset: Duration) -> String {
    (OffsetDateTime::now_utc() + offset)
        .format(&Rfc3339)
        .expect("valid UTC timestamp")
}

fn response(status: u16, status_text: &str, body: Value) -> StudioResponse {
    let body = serde_json::to_string_pretty(&body).expect("sandbox JSON response");
    StudioResponse {
        status,
        status_text: status_text.into(),
        size_bytes: body.len(),
        body,
        headers: BTreeMap::from([
            (
                "content-type".into(),
                "application/json; charset=utf-8".into(),
            ),
            (
                "x-request-id".into(),
                format!("req_{}", Uuid::new_v4().simple()),
            ),
            ("cache-control".into(), "no-store".into()),
            ("x-powered-by".into(), "Precision-Slate-Sandbox".into()),
            ("x-ratelimit-limit".into(), "1000".into()),
            ("x-ratelimit-remaining".into(), "999".into()),
            (
                "date".into(),
                OffsetDateTime::now_utc()
                    .format(&Rfc2822)
                    .expect("valid HTTP date")
                    .replace(" +0000", " GMT"),
            ),
        ]),
        cookies: Vec::new(),
        duration_ms: 0,
        final_url: String::new(),
    }
}

fn text<'a>(body: &'a Value, key: &str, fallback: &'a str) -> &'a str {
    body[key].as_str().unwrap_or(fallback)
}

impl SandboxState {
    fn dispatch(&mut self, input: &StudioRequest, target: &Url) -> StudioResponse {
        let path = target.path();
        let body: Value = serde_json::from_str(&input.body).unwrap_or(Value::Null);
        let query: BTreeMap<_, _> = target.query_pairs().collect();
        let resource: Vec<_> = path
            .trim_start_matches("/api/sandbox/")
            .split('/')
            .collect();
        let timestamp = now(Duration::ZERO);
        match (input.method.as_str(), resource.as_slice()) {
            ("GET", ["transactions"]) => {
                let limit = query
                    .get("limit")
                    .and_then(|limit| limit.parse::<i64>().ok())
                    .filter(|limit| *limit != 0)
                    .unwrap_or(25)
                    .clamp(1, 100) as usize;
                let matches: Vec<_> = self
                    .transactions
                    .iter()
                    .filter(|item| {
                        query.get("status").is_none_or(|status| {
                            status.is_empty() || item["status"].as_str() == Some(status)
                        }) && query.get("currency").is_none_or(|currency| {
                            currency.is_empty()
                                || item["currency"]
                                    .as_str()
                                    .is_some_and(|value| value.eq_ignore_ascii_case(currency))
                        })
                    })
                    .collect();
                response(
                    200,
                    "OK",
                    json!({"object":"list","url":path,"has_more":matches.len() > limit,
                    "total_count":matches.len(),"data":matches.iter().take(limit).collect::<Vec<_>>()}),
                )
            }
            ("POST", ["payment-intents"]) => {
                let Some(amount) = body["amount"].as_f64().filter(|amount| *amount > 0.0) else {
                    return response(
                        400,
                        "Bad Request",
                        json!({"error":{"type":"invalid_request_error",
                        "code":"parameter_invalid_integer","param":"amount","message":"A positive amount is required."}}),
                    );
                };
                let id = format!("pi_{}", Uuid::new_v4().simple());
                let status = if body["capture_method"] == "manual" {
                    "requires_capture"
                } else {
                    "succeeded"
                };
                let transaction = json!({"id":id,"object":"payment_intent","amount":amount.round() as i64,
                    "currency":text(&body,"currency","usd").to_ascii_lowercase(),"status":status,
                    "customer":text(&body,"customer","cus_N8v2Lm94Pq1rT"),
                    "payment_method":text(&body,"payment_method","pm_card_visa_4242"),
                    "description":text(&body,"description","API Payment Intent"),"created_at":timestamp,
                    "metadata":body["metadata"].as_object().map_or_else(||json!({"source":"precision-slate"}), |values| json!(values))});
                self.transactions.insert(0, transaction.clone());
                let mut reply = response(201, "Created", transaction);
                reply
                    .headers
                    .insert("location".into(), format!("/api/sandbox/transactions/{id}"));
                reply.cookies.push(format!(
                    "ps_idempotency={id}; Path=/; HttpOnly; SameSite=Lax"
                ));
                reply
            }
            ("PATCH", ["charges", id, "capture"]) => {
                let Some(transaction) = self.transactions.iter_mut().find(|item| item["id"] == *id)
                else {
                    return response(
                        404,
                        "Not Found",
                        json!({"error":{"code":"resource_missing","message":format!("No payment intent found with id \"{id}\".")}}),
                    );
                };
                transaction["status"] = json!("succeeded");
                if let Some(amount) = body["amount_to_capture"].as_f64() {
                    transaction["amount"] = json!(amount.round() as i64);
                }
                let mut captured = transaction.clone();
                captured["captured"] = json!(true);
                captured["captured_at"] = json!(timestamp);
                response(200, "OK", captured)
            }
            ("DELETE", ["webhooks", id]) => response(
                200,
                "OK",
                json!({
                    "id":id,"object":"webhook_endpoint","deleted":true,"revoked_at":timestamp
                }),
            ),
            ("POST", ["auth", "token"]) => {
                let mut reply = response(
                    200,
                    "OK",
                    json!({
                        "token_type":"Bearer","access_token":format!("ps_live_tok_{}",Uuid::new_v4().simple()),
                        "expires_in":3600,"scope":text(&body,"scope","payments:read payments:write"),"issued_at":timestamp,
                        "subject":text(&body,"client_id","svc_billing_gateway")
                    }),
                );
                reply
                    .headers
                    .insert("x-auth-issuer".into(), "auth.precisionslate.dev".into());
                reply.cookies.push(format!(
                    "ps_session=sess_{}; Path=/; HttpOnly; Secure; Max-Age=3600",
                    Uuid::new_v4().simple()
                ));
                reply.cookies.push(format!(
                    "ps_csrf={}; Path=/; SameSite=Strict",
                    Uuid::new_v4().simple()
                ));
                reply
            }
            ("GET", ["auth", "session"]) => {
                let authorized = input.headers.iter().any(|(name, value)| {
                    name.eq_ignore_ascii_case("authorization")
                        && value.to_ascii_lowercase().starts_with("bearer ")
                        && value.trim().len() >= 12
                });
                if !authorized {
                    let mut reply = response(
                        401,
                        "Unauthorized",
                        json!({"error":{
                            "code":"missing_bearer_token","message":"Authorization header with a valid Bearer token is required."
                        }}),
                    );
                    reply.headers.insert(
                        "www-authenticate".into(),
                        "Bearer realm=\"api\", error=\"invalid_token\"".into(),
                    );
                    return reply;
                }
                response(
                    200,
                    "OK",
                    json!({"active":true,"session_id":"sess_9f41b2c8e701",
                        "principal":{"id":"usr_a91f0c","email":"backend-eng@acme-cloud.io","role":"staff_engineer","org_id":"org_acme_core"},
                        "scopes":["payments:read","payments:write","webhooks:manage"],"expires_at":now(Duration::hours(1))
                    }),
                )
            }
            ("PUT", ["policies", id]) => {
                let old = self.policies.get(*id).unwrap_or(&Value::Null);
                let scopes = body["scopes"]
                    .as_array()
                    .or_else(|| old["scopes"].as_array())
                    .cloned()
                    .unwrap_or_default();
                let policy = json!({"id":id,"name":text(&body,"name",text(old,"name","Custom Policy")),
                    "effect":if body["effect"] == "deny" { "deny" } else { "allow" },
                    "scopes":scopes,"updated_at":timestamp,"updated_by":"usr_a91f0c"});
                self.policies.insert((*id).into(), policy.clone());
                response(200, "OK", policy)
            }
            (_, ["echo"]) => response(
                200,
                "OK",
                json!({"method":input.method,"path":path,"query":query,
                "headers_received":input.headers,"json_body":body,"raw_body_length":input.body.len(),"timestamp":timestamp}),
            ),
            _ => response(
                404,
                "Not Found",
                json!({"error":{"code":"route_not_found","message":format!("Sandbox route {} {path} does not exist.",input.method)}}),
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn sandbox_create_capture_and_list_share_state() {
        let sandbox = Sandbox::default();
        let run = |method: &str, url: &str, body: &str| {
            sandbox.execute(StudioRequest {
                method: method.into(),
                url: url.into(),
                body: body.into(),
                headers: BTreeMap::new(),
                multipart: None,
                binary_file: None,
            })
        };
        let created = run(
            "POST",
            "/api/sandbox/payment-intents",
            r#"{"amount":800,"capture_method":"manual"}"#,
        )
        .await
        .unwrap();
        assert_eq!(created.status, 201);
        let transaction: Value = serde_json::from_str(&created.body).unwrap();
        let id = transaction["id"].as_str().unwrap();
        let capture = format!("/api/sandbox/charges/{id}/capture");
        assert_eq!(run("PATCH", &capture, "{}").await.unwrap().status, 200);
        let list = run(
            "GET",
            "/api/sandbox/transactions?status=succeeded&limit=1",
            "",
        )
        .await
        .unwrap();
        let list: Value = serde_json::from_str(&list.body).unwrap();
        assert_eq!(list["data"][0]["id"], id);
        assert_eq!(list["data"][0]["status"], "succeeded");
    }

    #[tokio::test]
    async fn sends_multipart_form_with_text_and_file() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };

        let temp_file = std::env::temp_dir().join(format!("postdove-test-{}.xls", Uuid::new_v4()));
        std::fs::write(&temp_file, b"FAKE_EXCEL_BYTES_123").unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/upload", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .unwrap();
            let mut raw = Vec::new();
            let mut chunk = [0; 1024];
            loop {
                match socket.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        raw.extend_from_slice(&chunk[..n]);
                        if raw.windows(4).any(|w| w == b"--\r\n") {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let text = String::from_utf8_lossy(&raw).into_owned();
            assert!(text.to_ascii_lowercase().contains("multipart/form-data; boundary="));
            assert!(text.contains("name=\"message_type\"\r\n\r\nexcel\r\n"));
            assert!(text.contains("name=\"file\"; filename=\"postdove-test-"));
            assert!(text.contains("Content-Type: application/vnd.ms-excel"));
            assert!(text.contains("FAKE_EXCEL_BYTES_123"));
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}")
                .unwrap();
        });

        let sandbox = Sandbox::default();
        let reply = sandbox
            .execute(StudioRequest {
                method: "POST".into(),
                url,
                headers: BTreeMap::new(),
                body: String::new(),
                multipart: Some(vec![
                    MultipartField {
                        key: "message_type".into(),
                        field_type: "text".into(),
                        value: "excel".into(),
                        content_type: String::new(),
                    },
                    MultipartField {
                        key: "file".into(),
                        field_type: "file".into(),
                        value: temp_file.to_string_lossy().into_owned(),
                        content_type: String::new(),
                    },
                ]),
                binary_file: None,
            })
            .await
            .unwrap();
        server.join().unwrap();
        let _ = std::fs::remove_file(&temp_file);
        assert_eq!(reply.status, 200);
    }
}
