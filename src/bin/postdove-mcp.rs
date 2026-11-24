use postdove::{Request, send};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, BufRead, Write};

const PROTOCOL: &str = "2025-11-25";
const TOOL: &str = "send_http_request";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Arguments {
    url: String,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    headers: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    bearer: String,
}

fn tool() -> Value {
    json!({
        "name": TOOL,
        "description": "Send one HTTP or HTTPS request. A request may change remote state. Returns status, duration, headers, and up to 1 MiB of body.",
        "inputSchema": {
            "type": "object",
            "required": ["url"],
            "additionalProperties": false,
            "properties": {
                "url": {"type": "string", "description": "Complete HTTP or HTTPS URL, including query parameters."},
                "method": {"type": "string", "default": "GET"},
                "headers": {"type": "string", "description": "One Name: value header per line."},
                "body": {"type": "string", "description": "Raw request body."},
                "bearer": {"type": "string", "description": "Optional Bearer token."}
            }
        },
        "annotations": {"readOnlyHint": false, "destructiveHint": true, "openWorldHint": true}
    })
}

fn call(arguments: Value) -> Value {
    let args: Arguments = match serde_json::from_value(arguments) {
        Ok(args) => args,
        Err(error) => return tool_error(format!("Invalid arguments: {error}")),
    };
    match send(Request {
        method: args.method.unwrap_or_else(|| "GET".into()),
        url: args.url,
        headers: args.headers,
        body: args.body,
        bearer: args.bearer,
        ..Request::default()
    }) {
        Ok(response) => {
            let data = json!({
                "status": response.status,
                "elapsedMs": response.elapsed_ms,
                "headers": response.headers,
                "body": response.body,
                "bytes": response.bytes,
                "truncated": response.truncated
            });
            json!({
                "content": [{"type": "text", "text": data.to_string()}],
                "structuredContent": data,
                "isError": false
            })
        }
        Err(error) => tool_error(error),
    }
}

fn tool_error(text: String) -> Value {
    json!({"content": [{"type": "text", "text": text}], "isError": true})
}

fn rpc_error(id: Value, code: i32, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

#[derive(Default, PartialEq)]
enum State {
    #[default]
    New,
    Initializing,
    Ready,
}

fn handle(line: &str, state: &mut State) -> Option<Value> {
    let message: Value = match serde_json::from_str(line) {
        Ok(message) => message,
        Err(_) => return Some(rpc_error(Value::Null, -32700, "Parse error")),
    };
    let id = message
        .get("id")
        .filter(|id| id.is_string() || id.is_i64() || id.is_u64());
    let method = message["method"].as_str();
    if message["jsonrpc"] != "2.0"
        || method.is_none()
        || (message.get("id").is_some() && id.is_none())
    {
        return Some(rpc_error(
            id.cloned().unwrap_or(Value::Null),
            -32600,
            "Invalid request",
        ));
    }
    let method = method.unwrap();
    let Some(id) = id.cloned() else {
        if method == "notifications/initialized" && *state == State::Initializing {
            *state = State::Ready;
        }
        return None;
    };
    let params = &message["params"];
    let result = match method {
        "initialize" if *state == State::New => {
            if params["protocolVersion"].as_str().is_none() {
                return Some(rpc_error(id, -32602, "Expected protocolVersion"));
            }
            *state = State::Initializing;
            json!({
                "protocolVersion": PROTOCOL,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "postdove", "version": env!("CARGO_PKG_VERSION")}
            })
        }
        "initialize" => return Some(rpc_error(id, -32600, "Already initialized")),
        "ping" => json!({}),
        "tools/list" | "tools/call" if *state != State::Ready => {
            return Some(rpc_error(id, -32002, "Server not initialized"));
        }
        "tools/list" => json!({"tools": [tool()]}),
        "tools/call" if params["name"] == TOOL => call(
            params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({})),
        ),
        "tools/call" => return Some(rpc_error(id, -32602, "Unknown or missing tool name")),
        _ => return Some(rpc_error(id, -32601, "Method not found")),
    };
    Some(json!({"jsonrpc": "2.0", "id": id, "result": result}))
}

fn main() -> io::Result<()> {
    let mut state = State::default();
    let mut stdout = io::stdout().lock();
    for line in io::stdin().lock().lines() {
        let line = line?;
        if let Some(reply) = handle(&line, &mut state) {
            serde_json::to_writer(&mut stdout, &reply)?;
            writeln!(stdout)?;
            stdout.flush()?;
        }
    }
    Ok(())
}
