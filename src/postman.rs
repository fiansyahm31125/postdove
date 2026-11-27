use crate::Request;
use crate::collection::Collection;
use serde_json::{Value, json};
use std::collections::BTreeSet;

const SCHEMA: &str = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

pub fn import(input: &str) -> Result<(Collection, Vec<Request>), String> {
    let mut root: Value = serde_json::from_str(input.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("Invalid collection JSON: {error}"))?;
    let name = root["info"]["name"]
        .as_str()
        .filter(|name| !name.trim().is_empty())
        .ok_or("Collection has no info.name.")?
        .to_owned();
    let schema = root["info"]["schema"].as_str().unwrap_or_default();
    if !schema.contains("/v2.1.0/") && !schema.contains("/v2.0.0/") {
        return Err("Select a Postman Collection v2.0 or v2.1 JSON file.".into());
    }
    let version = match &root["info"]["version"] {
        Value::String(value) => value.clone(),
        Value::Object(value) => ["major", "minor", "patch"]
            .iter()
            .map(|key| {
                value
                    .get(*key)
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .to_string()
            })
            .collect::<Vec<_>>()
            .join("."),
        _ => String::new(),
    };
    let docs = description(&root["info"]["description"]).to_owned();
    let variables = root["variable"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|var| var["disabled"] != true)
        .filter_map(|var| {
            let key = var["key"].as_str().or_else(|| var["id"].as_str())?;
            let value = var["value"].as_str().map(str::to_owned).unwrap_or_else(|| {
                if var["value"].is_null() {
                    String::new()
                } else {
                    var["value"].to_string()
                }
            });
            Some(format!("{key}={value}"))
        })
        .collect::<Vec<_>>()
        .join("\n");
    let items = root
        .get_mut("item")
        .and_then(|items| items.take().as_array().cloned())
        .ok_or("Collection has no item array.")?;
    let mut folders = BTreeSet::new();
    let mut requests = Vec::new();
    let folder_metadata = import_items(items, "", &mut folders, &mut requests, 0)?;
    root["item"] = Value::Array(folder_metadata);
    Ok((
        Collection {
            name,
            version,
            docs,
            variables,
            folders: folders.into_iter().collect(),
            postman_collection: Some(root),
            ..Collection::default()
        },
        requests,
    ))
}

fn description(value: &Value) -> &str {
    value
        .as_str()
        .or_else(|| value["content"].as_str())
        .unwrap_or_default()
}

fn sanitize_folder_name(raw: Option<&str>) -> String {
    let trimmed = raw.unwrap_or_default().trim();
    if trimmed.is_empty() {
        return "Untitled folder".into();
    }
    let parts: Vec<&str> = trimmed
        .split('/')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();
    if parts.is_empty() {
        "Untitled folder".into()
    } else {
        parts.join(" - ")
    }
}

fn extract_url(source: &Value) -> Option<String> {
    if let Some(raw) = source
        .as_str()
        .or_else(|| source["url"].as_str())
        .or_else(|| source["url"]["raw"].as_str())
        .filter(|value| !value.trim().is_empty())
    {
        return Some(raw.to_owned());
    }
    let url = source["url"].as_object()?;
    let host = match url.get("host") {
        Some(Value::String(value)) => value.trim().to_owned(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join("."),
        _ => String::new(),
    };
    let path = match url.get("path") {
        Some(Value::String(value)) => value.trim_start_matches('/').to_owned(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join("/"),
        _ => String::new(),
    };
    if host.is_empty() && path.is_empty() {
        return None;
    }
    let protocol = url
        .get("protocol")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut built = String::new();
    if let Some(protocol) = protocol {
        built.push_str(protocol);
        built.push_str("://");
    }
    built.push_str(&host);
    if !path.is_empty() {
        if !built.is_empty() && !built.ends_with('/') {
            built.push('/');
        }
        built.push_str(&path);
    }
    if let Some(queries) = url.get("query").and_then(Value::as_array) {
        let pairs: Vec<String> = queries
            .iter()
            .filter(|entry| entry["disabled"] != true)
            .filter_map(|entry| {
                let key = entry["key"].as_str()?.trim();
                if key.is_empty() {
                    return None;
                }
                let value = entry["value"].as_str().unwrap_or_default();
                Some(format!("{key}={value}"))
            })
            .collect();
        if !pairs.is_empty() {
            built.push('?');
            built.push_str(&pairs.join("&"));
        }
    }
    Some(built)
}

fn extract_bearer(auth: &Value) -> String {
    if auth["type"].as_str() != Some("bearer") {
        return String::new();
    }
    if let Some(items) = auth["bearer"].as_array() {
        for entry in items {
            if entry["key"].as_str() == Some("token") {
                return entry["value"].as_str().unwrap_or_default().to_owned();
            }
        }
    }
    auth["bearer"]["token"]
        .as_str()
        .unwrap_or_default()
        .to_owned()
}

fn import_items(
    items: Vec<Value>,
    parent: &str,
    folders: &mut BTreeSet<String>,
    requests: &mut Vec<Request>,
    depth: usize,
) -> Result<Vec<Value>, String> {
    if depth > 32 {
        return Err("Collection folders are nested too deeply.".into());
    }
    let mut metadata = Vec::new();
    for mut item in items {
        if !item.is_object() {
            return Err("Collection contains an invalid item.".into());
        }
        if let Some(children) = item["item"].as_array().cloned() {
            let base_name = sanitize_folder_name(item["name"].as_str());
            let mut name = base_name.clone();
            let mut suffix = 2usize;
            let path = loop {
                let candidate = if parent.is_empty() {
                    name.clone()
                } else {
                    format!("{parent}/{name}")
                };
                if folders.insert(candidate.clone()) {
                    break candidate;
                }
                name = format!("{base_name} ({suffix})");
                suffix += 1;
            };
            item["name"] = Value::String(name);
            item["item"] =
                Value::Array(import_items(children, &path, folders, requests, depth + 1)?);
            metadata.push(item);
            continue;
        }
        let source = &item["request"];
        let name = item["name"]
            .as_str()
            .unwrap_or("Untitled request")
            .to_owned();
        let url = extract_url(source)
            .ok_or_else(|| format!("Request '{name}' has no URL string or url.raw."))?;
        let headers_value = &source["header"];
        let headers = if let Some(raw) = headers_value.as_str() {
            raw.to_owned()
        } else {
            headers_value
                .as_array()
                .into_iter()
                .flatten()
                .filter(|header| header["disabled"] != true)
                .filter_map(|header| {
                    let key = header["key"].as_str()?.trim();
                    if key.is_empty() {
                        return None;
                    }
                    let value = header["value"].as_str().unwrap_or_default();
                    Some(format!("{key}: {value}"))
                })
                .collect::<Vec<_>>()
                .join("\n")
        };
        let body = if source["body"]["disabled"] == true {
            String::new()
        } else {
            source["body"]["raw"]
                .as_str()
                .unwrap_or_default()
                .to_owned()
        };
        let bearer = extract_bearer(&source["auth"]);
        let method = source["method"].as_str().unwrap_or("GET").to_owned();
        requests.push(Request {
            name,
            method,
            url,
            headers,
            body,
            bearer,
            folder: parent.to_owned(),
            postman_item: Some(item),
            ..Request::default()
        });
    }
    Ok(metadata)
}

pub fn export(collection: &Collection, requests: &[&Request]) -> Result<String, String> {
    let mut root = collection
        .postman_collection
        .clone()
        .unwrap_or_else(|| json!({"info": {}, "item": []}));
    root["info"]["name"] = json!(collection.name);
    root["info"]["schema"] = json!(SCHEMA);
    if !collection.version.is_empty() || root["info"].get("version").is_some() {
        if collection.version.is_empty() {
            root["info"].as_object_mut().unwrap().remove("version");
        } else {
            root["info"]["version"] = json!(collection.version);
        }
    }
    if !collection.docs.is_empty() || root["info"].get("description").is_some() {
        if root["info"]["description"].is_object() {
            root["info"]["description"]["content"] = json!(collection.docs);
        } else {
            root["info"]["description"] = json!(collection.docs);
        }
    }
    let mut variables = Vec::new();
    let original = root["variable"].as_array();
    for line in collection
        .variables
        .lines()
        .filter(|line| !line.trim().is_empty())
    {
        let (key, value) = line
            .split_once('=')
            .filter(|(key, _)| !key.trim().is_empty())
            .ok_or("Collection variables must use one name=value per line.")?;
        let key = key.trim();
        let previous = original.into_iter().flatten().find(|variable| {
            variable["disabled"] != true && (variable["key"] == key || variable["id"] == key)
        });
        let mut variable = previous.cloned().unwrap_or_else(|| json!({"key": key}));
        variable["value"] = json!(value.trim());
        variables.push(variable);
    }
    variables.extend(
        original
            .into_iter()
            .flatten()
            .filter(|variable| variable["disabled"] == true)
            .cloned(),
    );
    if !variables.is_empty() || root.get("variable").is_some() {
        root["variable"] = Value::Array(variables);
    }

    let mut items = root["item"].as_array().cloned().unwrap_or_default();
    let paths: BTreeSet<&str> = collection
        .folders
        .iter()
        .map(String::as_str)
        .chain(requests.iter().map(|request| request.folder.as_str()))
        .collect();
    retain_folder_metadata(&mut items, "", &paths);
    for path in &collection.folders {
        folder_items(&mut items, path);
    }
    for request in requests {
        let item = export_request(request, collection)?;
        if request.folder.is_empty() {
            items.push(item);
        } else {
            folder_items(&mut items, &request.folder).push(item);
        }
    }
    root["item"] = Value::Array(items);
    serde_json::to_string_pretty(&root).map_err(|error| error.to_string())
}

fn retain_folder_metadata(items: &mut Vec<Value>, parent: &str, paths: &BTreeSet<&str>) {
    items.retain_mut(|item| {
        let Some(name) = item["name"].as_str() else {
            return false;
        };
        let path = if parent.is_empty() {
            name.to_owned()
        } else {
            format!("{parent}/{name}")
        };
        let Some(children) = item["item"].as_array_mut() else {
            return false;
        };
        let prefix = format!("{path}/");
        let used = paths.contains(path.as_str())
            || paths
                .range(prefix.as_str()..)
                .next()
                .is_some_and(|candidate| candidate.starts_with(&prefix));
        if used {
            retain_folder_metadata(children, &path, paths);
        }
        used
    });
}

fn folder_items<'a>(items: &'a mut Vec<Value>, path: &str) -> &'a mut Vec<Value> {
    let (name, rest) = path.split_once('/').unwrap_or((path, ""));
    let index = items
        .iter()
        .position(|item| item["name"] == name && item["item"].is_array())
        .unwrap_or_else(|| {
            items.push(json!({"name": name, "item": []}));
            items.len() - 1
        });
    let children = items[index]["item"].as_array_mut().unwrap();
    if rest.is_empty() {
        children
    } else {
        folder_items(children, rest)
    }
}

fn export_request(request: &Request, collection: &Collection) -> Result<Value, String> {
    let mut item = request
        .postman_item
        .clone()
        .unwrap_or_else(|| json!({"request": {}}));
    item["name"] = json!(request.name);
    let source = &mut item["request"];
    if !source.is_object() {
        *source = json!({});
    }
    source["method"] = json!(request.method);
    if !source["url"].is_object() || source["url"]["raw"] != request.url {
        source["url"] = json!(request.url);
    }
    let names: BTreeSet<_> = request
        .headers
        .lines()
        .filter_map(|line| line.split_once(':'))
        .map(|(name, _)| name.trim().to_ascii_lowercase())
        .collect();
    let defaults = collection.headers.lines().filter(|line| {
        !line
            .split_once(':')
            .is_some_and(|(name, _)| names.contains(&name.trim().to_ascii_lowercase()))
    });
    let mut headers = source["header"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|header| header["disabled"] == true)
        .cloned()
        .collect::<Vec<_>>();
    for line in defaults
        .chain(request.headers.lines())
        .filter(|line| !line.trim().is_empty())
    {
        let (name, value) = line
            .split_once(':')
            .filter(|(name, _)| !name.trim().is_empty())
            .ok_or_else(|| format!("Invalid header in '{}'. Use Name: value.", request.name))?;
        headers.push(json!({"key": name.trim(), "value": value.trim()}));
    }
    if !headers.is_empty() || source.get("header").is_some() {
        source["header"] = Value::Array(headers);
    }
    if source["body"]["mode"] == "raw" && source["body"]["disabled"] != true {
        source["body"]["raw"] = json!(request.body);
    } else if !request.body.is_empty() {
        source["body"] = json!({"mode": "raw", "raw": request.body});
    }
    Ok(item)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_collection_round_trip_preserves_scripts_and_templates() {
        let document = json!({
            "info": {"name": "Demo", "schema": SCHEMA, "description": "Documentation"},
            "variable": [{"key": "base_url", "value": "https://example.com"}],
            "item": [{"name": "Outer", "item": [{"name": "Inner", "item": [{
                "name": "Check",
                "request": {"method": "POST", "url": {"raw":"{{base_url}}/health"}, "body": {"mode":"raw","raw":"{}"}},
                "event": [{"listen": "test", "script": {"exec": ["pm.test('health', () => {});"]}}]
            }]}]}]
        });
        let (collection, requests) = import(&document.to_string()).unwrap();
        assert_eq!(requests[0].folder, "Outer/Inner");
        let exported = export(&collection, &requests.iter().collect::<Vec<_>>()).unwrap();
        let (_, imported) = import(&exported).unwrap();
        assert_eq!(imported[0].url, "{{base_url}}/health");
        assert_eq!(imported[0].body, "{}");
        assert_eq!(
            imported[0].postman_item.as_ref().unwrap()["event"],
            document["item"][0]["item"][0]["item"][0]["event"]
        );
    }

    #[test]
    fn export_omits_deleted_imported_subfolder() {
        let document = json!({
            "info": {"name": "Demo", "schema": SCHEMA},
            "item": [{"name": "Outer", "description": "Keep this", "item": [
                {"name": "Deleted", "item": []}
            ]}]
        });
        let (mut collection, _) = import(&document.to_string()).unwrap();
        collection.folders = vec!["Outer".into()];
        let exported: Value = serde_json::from_str(&export(&collection, &[]).unwrap()).unwrap();
        assert_eq!(exported["item"][0]["description"], "Keep this");
        assert_eq!(exported["item"][0]["item"], json!([]));
    }

    #[test]
    fn imports_bruno_exported_postman_with_slash_in_folder_name_and_variables() {
        let document = json!({
            "info": {"name": "Insomnia", "description": null, "schema": SCHEMA},
            "item": [
                {
                    "name": "messager/IG",
                    "item": [
                        {
                            "name": "Send Teks",
                            "request": {
                                "method": "POST",
                                "header": [],
                                "auth": {"type": "noauth"},
                                "url": {"raw": "{{BASE_URL}}/webhook/service/meta"},
                                "body": {
                                    "mode": "raw",
                                    "raw": "{\"object\":\"page\"}",
                                    "options": {"raw": {"language": "json"}}
                                }
                            }
                        }
                    ]
                },
                {
                    "name": "message",
                    "item": [
                        {
                            "name": "whatsapp",
                            "item": [
                                {
                                    "name": "Send Pesan",
                                    "request": {
                                        "method": "POST",
                                        "header": [],
                                        "url": {"raw": "http://localhost:3430/webhook/service/meta"},
                                        "body": {"mode": "raw", "raw": "{\"ok\":true}"}
                                    }
                                }
                            ]
                        }
                    ]
                }
            ],
            "variable": [
                {"key": "BASE_URL", "value": "http://localhost:3430", "type": "default"}
            ]
        });

        let (collection, requests) = import(&document.to_string()).unwrap();
        assert_eq!(collection.name, "Insomnia");
        assert_eq!(collection.variables, "BASE_URL=http://localhost:3430");
        assert_eq!(
            collection.folders,
            vec!["message", "message/whatsapp", "messager - IG"]
        );
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].folder, "messager - IG");
        assert_eq!(requests[0].url, "{{BASE_URL}}/webhook/service/meta");
        assert_eq!(requests[1].folder, "message/whatsapp");

        let exported = export(&collection, &requests.iter().collect::<Vec<_>>()).unwrap();
        let (reimported, reimported_requests) = import(&exported).unwrap();
        assert_eq!(reimported.folders, collection.folders);
        assert_eq!(reimported_requests.len(), 2);
    }

    #[test]
    fn handles_duplicate_folders_v2_0_schema_and_bearer_auth() {
        let document = json!({
            "info": {
                "name": "Legacy",
                "schema": "https://schema.getpostman.com/json/collection/v2.0.0/collection.json"
            },
            "item": [
                {
                    "name": "Auth",
                    "item": [{
                        "name": "Me",
                        "request": {
                            "method": "GET",
                            "auth": {"type": "bearer", "bearer": [{"key": "token", "value": "secret123"}]},
                            "url": {
                                "protocol": "https",
                                "host": ["api", "example", "com"],
                                "path": ["v1", "me"],
                                "query": [{"key": "expand", "value": "roles"}]
                            }
                        }
                    }]
                },
                {"name": "Auth", "item": []}
            ]
        });

        let (collection, requests) = import(&document.to_string()).unwrap();
        assert_eq!(collection.folders, vec!["Auth", "Auth (2)"]);
        assert_eq!(requests[0].url, "https://api.example.com/v1/me?expand=roles");
        assert_eq!(requests[0].bearer, "secret123");
    }
}
