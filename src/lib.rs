use serde::{Deserialize, Serialize};

pub mod collection;
pub mod postman;

#[derive(Clone, Serialize, Deserialize)]
pub struct Request {
    pub name: String,
    #[serde(default)]
    pub collection: usize,
    #[serde(default)]
    pub folder: String,
    #[serde(default)]
    pub postman_item: Option<serde_json::Value>,
    pub method: String,
    pub url: String,
    pub headers: String,
    pub body: String,
    pub bearer: String,
}

impl Default for Request {
    fn default() -> Self {
        Self {
            name: String::new(),
            collection: 0,
            folder: String::new(),
            postman_item: None,
            method: "GET".into(),
            url: String::new(),
            headers: String::new(),
            body: String::new(),
            bearer: String::new(),
        }
    }
}

#[derive(Serialize)]
pub struct Response {
    pub status: String,
    pub elapsed_ms: u128,
    pub headers: String,
    pub body: String,
    pub bytes: usize,
    pub truncated: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };

    #[tokio::test]
    async fn sends_request_and_reads_response() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/echo", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .unwrap();
            let mut raw = Vec::new();
            let mut chunk = [0; 256];
            while !raw.ends_with(b"hello") {
                let count = socket.read(&mut chunk).unwrap();
                assert_ne!(count, 0);
                raw.extend_from_slice(&chunk[..count]);
            }
            let text = String::from_utf8(raw).unwrap().to_ascii_lowercase();
            assert!(text.starts_with("post /echo http/1.1"));
            assert!(text.contains("x-example: value"));
            assert!(text.contains("authorization: bearer token"));
            socket.write_all(b"HTTP/1.1 201 Created\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}").unwrap();
        });
        let response = send(Request {
            method: "POST".into(),
            url,
            headers: "X-Example: value".into(),
            body: "hello".into(),
            bearer: "token".into(),
            ..Request::default()
        })
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(response.status, "201 Created");
        assert_eq!(response.bytes, 11);
        assert!(response.body.contains("\"ok\": true"));
    }

    #[tokio::test]
    async fn rejects_unsupported_scheme_and_malformed_header() {
        assert!(
            send(Request {
                url: "file:///tmp/example".into(),
                ..Request::default()
            })
            .await
            .is_err()
        );
        assert!(
            send(Request {
                url: "http://localhost".into(),
                headers: "invalid".into(),
                ..Request::default()
            })
            .await
            .is_err()
        );
    }
}

pub async fn send(request: Request) -> Result<Response, String> {
    use reqwest::{
        Client, Method, Url,
        header::{AUTHORIZATION, HeaderMap, HeaderName, HeaderValue},
    };
    use std::time::{Duration, Instant};

    const LIMIT: usize = 1024 * 1024;
    let url = Url::parse(request.url.trim()).map_err(|error| format!("Invalid URL: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Use an http:// or https:// URL.".into());
    }
    let method = Method::from_bytes(request.method.as_bytes())
        .map_err(|_| "Invalid HTTP method.".to_string())?;
    let mut headers = HeaderMap::new();
    for (index, line) in request.headers.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let invalid = || format!("Invalid header on line {}. Use Name: value.", index + 1);
        let (name, value) = line.split_once(':').ok_or_else(invalid)?;
        let name = HeaderName::from_bytes(name.trim().as_bytes()).map_err(|_| invalid())?;
        let value = HeaderValue::from_str(value.trim()).map_err(|_| invalid())?;
        headers.append(name, value);
    }
    let token = request.bearer.trim();
    if !token.is_empty() {
        let mut value = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_| "Invalid bearer token.".to_string())?;
        value.set_sensitive(true);
        headers.insert(AUTHORIZATION, value);
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Could not initialize HTTP client: {error}"))?;
    let mut builder = client.request(method, url).headers(headers);
    if !request.body.is_empty() {
        builder = builder.body(request.body);
    }

    let start = Instant::now();
    let mut response = builder
        .send()
        .await
        .map_err(|error| format!("Request failed: {}", error.without_url()))?;
    let status = response.status().to_string();
    let headers = response
        .headers()
        .iter()
        .map(|(name, value)| format!("{name}: {}", String::from_utf8_lossy(value.as_bytes())))
        .collect::<Vec<_>>()
        .join("\n");
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Could not read response: {}", error.without_url()))?
    {
        let remaining = LIMIT + 1 - bytes.len();
        bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        if bytes.len() > LIMIT {
            break;
        }
    }
    let elapsed_ms = start.elapsed().as_millis();
    let truncated = bytes.len() > LIMIT;
    bytes.truncate(LIMIT);
    let body = if !truncated && let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) {
        serde_json::to_string_pretty(&json).map_err(|error| error.to_string())?
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };
    Ok(Response {
        status,
        elapsed_ms,
        headers,
        body,
        bytes: bytes.len(),
        truncated,
    })
}
