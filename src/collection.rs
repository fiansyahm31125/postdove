use postdove::Request;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const COLLECTIONS_KEY: &str = "collections_v1";

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Collection {
    pub name: String,
    pub version: String,
    pub docs: String,
    pub folders: Vec<String>,
    pub environments: BTreeMap<String, String>,
    pub headers: String,
    pub variables: String,
    pub expected_status: String,
    pub postman_collection: Option<serde_json::Value>,
}

impl Collection {
    pub fn prepare(
        &self,
        draft: &Request,
        environment: Option<&str>,
        bearer: &str,
    ) -> Result<Request, String> {
        if let Some(mode) = draft
            .postman_item
            .as_ref()
            .and_then(|item| item["request"]["body"]["mode"].as_str())
            && mode != "raw"
            && draft.body.is_empty()
            && draft.postman_item.as_ref().unwrap()["request"]["body"]["disabled"] != true
        {
            return Err(format!(
                "Postman body mode '{mode}' must be converted to a raw body before sending."
            ));
        }

        let mut vars = BTreeMap::new();
        read_vars(&self.variables, &mut vars)?;
        if let Some(values) = environment.and_then(|name| self.environments.get(name)) {
            read_vars(values, &mut vars)?;
        }

        let mut request = draft.clone();
        let local_headers = expand(&request.headers, &vars)?;
        let local_names: Vec<_> = local_headers
            .lines()
            .filter_map(|line| line.split_once(':').map(|(name, _)| name.trim()))
            .collect();
        let defaults = expand(&self.headers, &vars)?;
        let mut headers: Vec<_> = defaults
            .lines()
            .filter(|line| {
                !line.split_once(':').is_some_and(|(name, _)| {
                    local_names
                        .iter()
                        .any(|local| local.eq_ignore_ascii_case(name.trim()))
                })
            })
            .collect();
        headers.push(&local_headers);
        request.headers = headers.join("\n");
        request.url = expand(&request.url, &vars)?;
        request.body = expand(&request.body, &vars)?;
        if request.bearer.trim().is_empty() {
            request.bearer = bearer.to_owned();
        }
        request.bearer = expand(&request.bearer, &vars)?;
        Ok(request)
    }

    pub fn status_check(&self) -> Result<Option<u16>, String> {
        let status = self.expected_status.trim();
        if status.is_empty() {
            return Ok(None);
        }
        status
            .parse::<u16>()
            .ok()
            .filter(|value| (100..=599).contains(value))
            .map(Some)
            .ok_or_else(|| "Expected status must be between 100 and 599.".to_owned())
    }
}

fn read_vars<'a>(text: &'a str, vars: &mut BTreeMap<&'a str, &'a str>) -> Result<(), String> {
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let (name, value) = line
            .split_once('=')
            .filter(|(name, _)| !name.trim().is_empty())
            .ok_or_else(|| "Use one name=value per line for variables.".to_owned())?;
        vars.insert(name.trim(), value.trim());
    }
    Ok(())
}

fn expand(input: &str, vars: &BTreeMap<&str, &str>) -> Result<String, String> {
    let mut output = String::new();
    let mut tail = input;
    while let Some((prefix, rest)) = tail.split_once("{{") {
        output.push_str(prefix);
        let (name, remaining) = rest
            .split_once("}}")
            .ok_or_else(|| "Unclosed {{variable}} placeholder.".to_owned())?;
        let value = vars
            .get(name.trim())
            .ok_or_else(|| format!("Undefined variable: {}", name.trim()))?;
        output.push_str(value);
        tail = remaining;
    }
    output.push_str(tail);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn environment_and_request_override_collection_defaults() {
        let mut collection = Collection {
            variables: "base=https://default.example".into(),
            headers: "X-Version: default\nX-Base: {{base}}".into(),
            ..Default::default()
        };
        collection
            .environments
            .insert("Local".into(), "base=http://localhost".into());
        let draft = Request {
            url: "{{base}}/health".into(),
            headers: "x-version: local".into(),
            ..Request::default()
        };
        let prepared = collection.prepare(&draft, Some("Local"), "token").unwrap();
        assert_eq!(prepared.url, "http://localhost/health");
        assert_eq!(
            prepared.headers,
            "X-Base: http://localhost\nx-version: local"
        );
        assert_eq!(prepared.bearer, "token");
        assert_eq!(draft.url, "{{base}}/health");
    }
}
