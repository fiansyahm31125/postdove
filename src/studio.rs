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
pub struct StudioRequest {
    method: String,
    url: String,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    #[serde(default)]
    body: String,
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
            body: input.body,
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
}
