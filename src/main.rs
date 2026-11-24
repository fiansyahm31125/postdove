#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod collection;
mod postman;

use collection::{COLLECTIONS_KEY, Collection};
use eframe::egui::{self, Color32, RichText, TextEdit};
use postdove::{Request, Response, send};
use std::sync::mpsc::{self, Receiver, TryRecvError};

const INK: Color32 = Color32::from_rgb(233, 255, 238);
const NEON: Color32 = Color32::from_rgb(145, 255, 111);
const MUTED: Color32 = Color32::from_rgb(159, 185, 166);
const RED: Color32 = Color32::from_rgb(255, 148, 153);
const METHODS: [&str; 7] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const STORAGE_KEY: &str = "saved_requests";

#[derive(Default, PartialEq)]
enum Editor {
    #[default]
    Params,
    Headers,
    Body,
    Auth,
}

#[derive(Default, PartialEq)]
enum CollectionTab {
    #[default]
    Overview,
    Headers,
    Vars,
    Auth,
    Tests,
    Environments,
}

#[derive(Default)]
struct Postdove {
    draft: Request,
    saved: Vec<Request>,
    collections: Vec<Collection>,
    active_collection: usize,
    collection_tab: CollectionTab,
    viewing_collection: bool,
    new_collection: String,
    new_folder: String,
    new_environment: String,
    environment: Option<String>,
    collection_tokens: std::collections::BTreeMap<usize, String>,
    expected_status: Option<u16>,
    transfer_status: Option<Result<String, String>>,
    selected: Option<usize>,
    history: Vec<Request>,
    editor: Editor,
    job: Option<Receiver<Result<Response, String>>>,
    result: Option<Result<Response, String>>,
    show_response_headers: bool,
    show_history: bool,
    filter: String,
}

impl Postdove {
    fn new(cc: &eframe::CreationContext<'_>) -> Self {
        cc.egui_ctx.set_theme(egui::Theme::Dark);
        let mut visuals = egui::Visuals::dark();
        visuals.panel_fill = Color32::BLACK;
        visuals.window_fill = Color32::from_gray(15);
        visuals.extreme_bg_color = Color32::from_gray(9);
        visuals.faint_bg_color = Color32::from_gray(16);
        visuals.override_text_color = Some(INK);
        visuals.selection.bg_fill = Color32::from_rgb(29, 66, 21);
        visuals.selection.stroke.color = NEON;
        visuals.text_cursor.stroke.color = NEON;
        cc.egui_ctx.set_visuals(visuals);
        cc.egui_ctx.style_mut(|style| {
            style.spacing.item_spacing = egui::vec2(10.0, 9.0);
            style.spacing.button_padding = egui::vec2(11.0, 5.0);
        });
        let mut collections: Vec<Collection> = cc
            .storage
            .and_then(|storage| eframe::get_value(storage, COLLECTIONS_KEY))
            .unwrap_or_default();
        if collections.is_empty() {
            collections.push(Collection {
                name: "Local collection".into(),
                ..Default::default()
            });
        }
        Self {
            collections,
            viewing_collection: true,
            saved: cc
                .storage
                .and_then(|storage| eframe::get_value(storage, STORAGE_KEY))
                .unwrap_or_default(),
            ..Self::default()
        }
    }

    fn save_request(&mut self) {
        let mut saved = self.draft.clone();
        if saved.name.trim().is_empty() {
            saved.name = saved.url.trim().into();
        }
        self.draft.name.clone_from(&saved.name);
        saved.bearer.clear();
        if let Some(index) = self.selected {
            self.saved[index] = saved;
        } else {
            self.saved.push(saved);
            self.selected = Some(self.saved.len() - 1);
        }
    }

    fn reset(&mut self) {
        self.selected = None;
        self.draft = Request {
            collection: self.active_collection,
            ..Request::default()
        };
        self.viewing_collection = false;
    }

    fn start(&mut self, ctx: &egui::Context) {
        let collection = &self.collections[self.draft.collection];
        let token = self
            .collection_tokens
            .get(&self.draft.collection)
            .map_or("", String::as_str);
        let prepared = collection
            .prepare(&self.draft, self.environment.as_deref(), token)
            .and_then(|request| Ok((request, collection.status_check()?)));
        let (request, expected_status) = match prepared {
            Ok(prepared) => prepared,
            Err(error) => {
                self.result = Some(Err(error));
                return;
            }
        };
        self.expected_status = expected_status;
        let mut history = self.draft.clone();
        history.bearer.clear();
        self.history.insert(0, history);
        self.history.truncate(30);
        let (sender, receiver) = mpsc::channel();
        let ctx = ctx.clone();
        std::thread::spawn(move || {
            let _ = sender.send(send(request));
            ctx.request_repaint();
        });
        self.job = Some(receiver);
        self.result = None;
        self.show_response_headers = false;
    }

    fn poll_response(&mut self) {
        let Some(job) = &self.job else { return };
        self.result = Some(match job.try_recv() {
            Ok(result) => result,
            Err(TryRecvError::Empty) => return,
            Err(TryRecvError::Disconnected) => Err("Request worker stopped unexpectedly.".into()),
        });
        self.job = None;
    }

    fn open_collection(&mut self, index: usize) {
        if self.active_collection != index {
            self.environment = None;
        }
        self.active_collection = index;
        self.viewing_collection = true;
    }

    fn open_request(&mut self, request: Request, index: Option<usize>) {
        self.open_collection(request.collection);
        self.draft = request;
        self.selected = index;
        self.viewing_collection = false;
    }

    fn sidebar(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            ui.selectable_value(&mut self.show_history, false, "Collections");
            ui.selectable_value(&mut self.show_history, true, "History");
        });
        ui.add(
            TextEdit::singleline(&mut self.filter)
                .hint_text("Filter requests")
                .desired_width(f32::INFINITY),
        );
        if !self.show_history {
            ui.horizontal(|ui| {
                ui.add(
                    TextEdit::singleline(&mut self.new_collection)
                        .hint_text("Collection name")
                        .desired_width((ui.available_width() - 38.0).max(60.0)),
                );
                let name = self.new_collection.trim();
                if ui
                    .add_enabled(!name.is_empty(), egui::Button::new("+"))
                    .on_hover_text("Create collection")
                    .clicked()
                {
                    self.collections.push(Collection {
                        name: name.to_owned(),
                        ..Default::default()
                    });
                    self.new_collection.clear();
                    self.open_collection(self.collections.len() - 1);
                }
            });
        }
        ui.separator();
        let needle = self.filter.trim().to_lowercase();
        let mut opened_collection = None;
        let mut opened_request = None;
        egui::ScrollArea::vertical()
            .id_salt("request_list")
            .show(ui, |ui| {
                if self.show_history {
                    for request in self
                        .history
                        .iter()
                        .filter(|request| matches_request(request, &needle))
                    {
                        if request_row(ui, request, false) {
                            opened_request = Some((request.clone(), None));
                        }
                    }
                    return;
                }
                for (index, collection) in self.collections.iter().enumerate() {
                    ui.push_id(index, |ui| {
                        egui::CollapsingHeader::new(&collection.name)
                            .id_salt("collection")
                            .default_open(index == self.active_collection)
                            .show(ui, |ui| {
                                if ui
                                    .selectable_label(
                                        self.viewing_collection && self.active_collection == index,
                                        "Collection settings",
                                    )
                                    .clicked()
                                {
                                    opened_collection = Some(index);
                                }
                                let requests =
                                    self.saved.iter().enumerate().filter(|(_, request)| {
                                        request.collection == index
                                            && matches_request(request, &needle)
                                    });
                                for (item, request) in requests
                                    .clone()
                                    .filter(|(_, request)| request.folder.is_empty())
                                {
                                    if request_row(
                                        ui,
                                        request,
                                        !self.viewing_collection && self.selected == Some(item),
                                    ) {
                                        opened_request = Some((request.clone(), Some(item)));
                                    }
                                }
                                for (folder_index, folder) in collection.folders.iter().enumerate()
                                {
                                    egui::CollapsingHeader::new(folder)
                                        .id_salt(("folder", folder_index))
                                        .default_open(true)
                                        .show(ui, |ui| {
                                            for (item, request) in requests
                                                .clone()
                                                .filter(|(_, request)| request.folder == *folder)
                                            {
                                                if request_row(
                                                    ui,
                                                    request,
                                                    !self.viewing_collection
                                                        && self.selected == Some(item),
                                                ) {
                                                    opened_request =
                                                        Some((request.clone(), Some(item)));
                                                }
                                            }
                                        });
                                }
                            });
                    });
                }
            });
        if let Some(index) = opened_collection {
            self.open_collection(index);
        }
        if let Some((request, index)) = opened_request {
            self.open_request(request, index);
        }
    }

    fn import_collection(&mut self) {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("Postman collection", &["json"])
            .pick_file()
        else {
            return;
        };
        let imported = std::fs::read_to_string(&path)
            .map_err(|error| format!("Could not read collection: {error}"))
            .and_then(|json| postman::import(&json));
        self.transfer_status = Some(imported.map(|(collection, mut requests)| {
            let index = self.collections.len();
            let message = format!(
                "Imported {} ({} requests).",
                collection.name,
                requests.len()
            );
            for request in &mut requests {
                request.collection = index;
            }
            self.collections.push(collection);
            self.saved.extend(requests);
            self.open_collection(index);
            self.collection_tab = CollectionTab::Overview;
            self.show_history = false;
            message
        }));
    }

    fn export_collection(&mut self) {
        let collection = &self.collections[self.active_collection];
        let requests: Vec<_> = self
            .saved
            .iter()
            .filter(|request| request.collection == self.active_collection)
            .collect();
        let json = match postman::export(collection, &requests) {
            Ok(json) => json,
            Err(error) => {
                self.transfer_status = Some(Err(error));
                return;
            }
        };
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
        let Some(path) = rfd::FileDialog::new()
            .add_filter("Postman collection", &["json"])
            .set_file_name(format!("{stem}.postman_collection.json"))
            .save_file()
        else {
            return;
        };
        self.transfer_status = Some(
            std::fs::write(&path, json)
                .map(|()| {
                    format!(
                        "Exported {} requests to {}.",
                        requests.len(),
                        path.display()
                    )
                })
                .map_err(|error| format!("Could not save collection: {error}")),
        );
    }

    fn collection_toolbar(&mut self, ui: &mut egui::Ui) {
        ui.horizontal_wrapped(|ui| {
            ui.strong(&self.collections[self.active_collection].name);
            if ui
                .selectable_label(self.viewing_collection, "Collection")
                .clicked()
            {
                self.viewing_collection = true;
            }
            if ui.button("+ New request").clicked() {
                self.reset();
            }
            if ui.button("Import collection").clicked() {
                self.import_collection();
            }
            if ui.button("Export collection").clicked() {
                self.export_collection();
            }
            if ui.button("Environments").clicked() {
                self.viewing_collection = true;
                self.collection_tab = CollectionTab::Environments;
            }
            egui::ComboBox::from_id_salt("environment_picker")
                .selected_text(self.environment.as_deref().unwrap_or("No environment"))
                .show_ui(ui, |ui| {
                    ui.selectable_value(&mut self.environment, None, "No environment");
                    for name in self.collections[self.active_collection].environments.keys() {
                        ui.selectable_value(&mut self.environment, Some(name.clone()), name);
                    }
                });
        });
        if let Some(status) = &self.transfer_status {
            match status {
                Ok(message) => ui.colored_label(NEON, message),
                Err(message) => ui.colored_label(RED, message),
            };
        }
        ui.separator();
    }

    fn collection_view(&mut self, ui: &mut egui::Ui) {
        ui.horizontal_wrapped(|ui| {
            for (tab, title) in [
                (CollectionTab::Overview, "Overview"),
                (CollectionTab::Headers, "Headers"),
                (CollectionTab::Vars, "Vars"),
                (CollectionTab::Auth, "Auth"),
                (CollectionTab::Tests, "Tests"),
                (CollectionTab::Environments, "Environments"),
            ] {
                ui.selectable_value(&mut self.collection_tab, tab, title);
            }
        });
        ui.separator();
        let collection = &mut self.collections[self.active_collection];
        match self.collection_tab {
            CollectionTab::Overview => {
                let count = self
                    .saved
                    .iter()
                    .filter(|request| request.collection == self.active_collection)
                    .count();
                ui.columns(2, |columns| {
                    let ui = &mut columns[0];
                    ui.heading("Collection details");
                    ui.label("Name");
                    ui.text_edit_singleline(&mut collection.name);
                    ui.label("Version");
                    ui.add(TextEdit::singleline(&mut collection.version).hint_text("Not set"));
                    ui.colored_label(
                        MUTED,
                        format!(
                            "{count} requests · {} environments",
                            collection.environments.len()
                        ),
                    );
                    ui.separator();
                    ui.label("Folders");
                    for folder in &collection.folders {
                        ui.label(folder);
                    }
                    ui.add(TextEdit::singleline(&mut self.new_folder).hint_text("Folder name"));
                    let folder = self.new_folder.trim();
                    let valid = !folder.is_empty()
                        && !collection.folders.iter().any(|existing| existing == folder);
                    if ui
                        .add_enabled(valid, egui::Button::new("Add folder"))
                        .clicked()
                    {
                        collection.folders.push(folder.to_owned());
                        self.new_folder.clear();
                    }
                    ui.separator();
                    if ui.button("Copy collection JSON").clicked() {
                        let requests: Vec<_> = self
                            .saved
                            .iter()
                            .filter(|request| request.collection == self.active_collection)
                            .collect();
                        match postman::export(collection, &requests) {
                            Ok(json) => ui.ctx().copy_text(json),
                            Err(error) => self.transfer_status = Some(Err(error)),
                        }
                    }

                    let ui = &mut columns[1];
                    ui.heading("Documentation");
                    edit_payload(
                        ui,
                        &mut collection.docs,
                        "Describe the collection in Markdown…",
                    );
                    if ui.button("Copy Markdown").clicked() {
                        ui.ctx().copy_text(collection.docs.clone());
                    }
                });
            }
            CollectionTab::Headers => {
                ui.colored_label(
                    MUTED,
                    "Default headers for all requests. Request headers override them.",
                );
                edit_payload(ui, &mut collection.headers, "Accept: application/json");
            }
            CollectionTab::Vars => {
                ui.colored_label(
                    MUTED,
                    "One name=value per line. Reference values with {{name}}.",
                );
                edit_payload(
                    ui,
                    &mut collection.variables,
                    "base_url=https://api.example.com",
                );
            }
            CollectionTab::Auth => {
                ui.colored_label(
                    MUTED,
                    "Default Bearer token for this session. A request token takes precedence.",
                );
                ui.add(
                    TextEdit::singleline(
                        self.collection_tokens
                            .entry(self.active_collection)
                            .or_default(),
                    )
                    .password(true)
                    .hint_text("Bearer token")
                    .desired_width(f32::INFINITY),
                );
            }
            CollectionTab::Tests => {
                ui.colored_label(
                    MUTED,
                    "Check the status code of each response in this collection.",
                );
                ui.add(
                    TextEdit::singleline(&mut collection.expected_status)
                        .hint_text("Expected status, e.g. 200"),
                );
            }
            CollectionTab::Environments => {
                ui.horizontal_wrapped(|ui| {
                    ui.add(
                        TextEdit::singleline(&mut self.new_environment)
                            .hint_text("Environment name"),
                    );
                    let name = self.new_environment.trim();
                    let valid = !name.is_empty() && !collection.environments.contains_key(name);
                    if ui
                        .add_enabled(valid, egui::Button::new("Add environment"))
                        .clicked()
                    {
                        collection
                            .environments
                            .insert(name.to_owned(), String::new());
                        self.environment = Some(name.to_owned());
                        self.new_environment.clear();
                    }
                });
                if let Some(values) = self
                    .environment
                    .as_ref()
                    .and_then(|name| collection.environments.get_mut(name))
                {
                    ui.colored_label(MUTED, "Environment values override collection variables. One name=value per line.");
                    edit_payload(ui, values, "base_url=http://localhost:8080");
                }
            }
        }
    }

    fn request_bar(&mut self, ui: &mut egui::Ui) {
        ui.horizontal_wrapped(|ui| {
            ui.add(
                TextEdit::singleline(&mut self.draft.name)
                    .hint_text("Untitled request")
                    .desired_width(210.0),
            );
            egui::ComboBox::from_id_salt("request_folder")
                .selected_text(if self.draft.folder.is_empty() {
                    "Collection root"
                } else {
                    &self.draft.folder
                })
                .show_ui(ui, |ui| {
                    ui.selectable_value(&mut self.draft.folder, String::new(), "Collection root");
                    for folder in &self.collections[self.draft.collection].folders {
                        ui.selectable_value(&mut self.draft.folder, folder.clone(), folder);
                    }
                });
            if ui
                .add_enabled(!self.draft.url.trim().is_empty(), egui::Button::new("Save"))
                .on_hover_text("Saves URL, headers, and body locally. Bearer field is excluded.")
                .clicked()
            {
                self.save_request();
            }
            if let Some(index) = self.selected {
                if ui.button("Remove saved").clicked() {
                    self.saved.remove(index);
                    self.selected = None;
                }
            }
        });
        ui.horizontal(|ui| {
            egui::ComboBox::from_id_salt("method")
                .selected_text(&self.draft.method)
                .show_ui(ui, |ui| {
                    for method in METHODS {
                        ui.selectable_value(&mut self.draft.method, method.into(), method);
                    }
                });
            ui.add(
                TextEdit::singleline(&mut self.draft.url)
                    .font(egui::TextStyle::Monospace)
                    .hint_text("https://api.example.com/items?limit=10")
                    .desired_width((ui.available_width() - 94.0).max(80.0)),
            );
            let ready = self.job.is_none() && !self.draft.url.trim().is_empty();
            let button =
                egui::Button::new(RichText::new("Send").strong().color(Color32::BLACK)).fill(NEON);
            let shortcut =
                ui.input_mut(|input| input.consume_key(egui::Modifiers::COMMAND, egui::Key::Enter));
            if ui.add_enabled(ready, button).clicked() || (ready && shortcut) {
                self.start(ui.ctx());
            }
        });
    }

    fn request_editor(&mut self, ui: &mut egui::Ui) {
        ui.strong("Request");
        ui.horizontal_wrapped(|ui| {
            ui.selectable_value(&mut self.editor, Editor::Params, "Params");
            ui.selectable_value(&mut self.editor, Editor::Headers, "Headers");
            ui.selectable_value(&mut self.editor, Editor::Body, "Body");
            ui.selectable_value(&mut self.editor, Editor::Auth, "Auth");
        });
        ui.separator();
        match self.editor {
            Editor::Params => {
                ui.colored_label(MUTED, "Query string. Changes update the URL.");
                query_editor(ui, &mut self.draft.url);
            }
            Editor::Headers => {
                ui.colored_label(MUTED, "Enter one header per line as Name: value.");
                edit_payload(
                    ui,
                    &mut self.draft.headers,
                    "Content-Type: application/json",
                );
            }
            Editor::Body => {
                ui.colored_label(MUTED, "Raw request body. Set Content-Type in Headers.");
                edit_payload(ui, &mut self.draft.body, "{\"name\": \"example\"}");
            }
            Editor::Auth => {
                ui.colored_label(MUTED, "Bearer token for the current request.");
                ui.add(
                    TextEdit::singleline(&mut self.draft.bearer)
                        .hint_text("Bearer token")
                        .password(true)
                        .desired_width(f32::INFINITY),
                );
            }
        }
    }

    fn response_view(&mut self, ui: &mut egui::Ui) {
        ui.strong("Response");
        match &mut self.result {
            Some(Ok(response)) => {
                ui.horizontal_wrapped(|ui| {
                    let color =
                        if response.status.starts_with('4') || response.status.starts_with('5') {
                            RED
                        } else {
                            NEON
                        };
                    ui.label(
                        RichText::new(&response.status)
                            .strong()
                            .monospace()
                            .color(color),
                    );
                    ui.colored_label(
                        MUTED,
                        format!(
                            "{} ms   ·   {} bytes{}",
                            response.elapsed_ms,
                            response.bytes,
                            if response.truncated {
                                " shown (truncated)"
                            } else {
                                ""
                            }
                        ),
                    );
                });
                ui.horizontal(|ui| {
                    ui.selectable_value(&mut self.show_response_headers, false, "Body");
                    ui.selectable_value(&mut self.show_response_headers, true, "Headers");
                    if ui.button("Copy").clicked() {
                        let text = if self.show_response_headers {
                            &response.headers
                        } else {
                            &response.body
                        };
                        ui.ctx().copy_text(text.clone());
                    }
                });
                if let Some(expected) = self.expected_status {
                    let passed = response
                        .status
                        .split_whitespace()
                        .next()
                        .and_then(|status| status.parse().ok())
                        == Some(expected);
                    ui.colored_label(
                        if passed { NEON } else { RED },
                        format!(
                            "{} · expected status {expected}",
                            if passed { "PASS" } else { "FAIL" }
                        ),
                    );
                }
                ui.separator();
                let mut content = if self.show_response_headers {
                    response.headers.as_str()
                } else {
                    response.body.as_str()
                };
                egui::ScrollArea::vertical()
                    .id_salt("response")
                    .max_height(ui.available_height().max(80.0))
                    .show(ui, |ui| {
                        ui.add(
                            TextEdit::multiline(&mut content)
                                .code_editor()
                                .interactive(true)
                                .desired_width(f32::INFINITY)
                                .desired_rows(5),
                        );
                    });
            }
            Some(Err(error)) => {
                ui.colored_label(RED, error.as_str());
            }
            None if self.job.is_some() => {
                ui.horizontal(|ui| {
                    ui.spinner();
                    ui.label("Waiting for response…");
                });
            }
            None => {
                ui.colored_label(MUTED, "Send a request to inspect its response.");
            }
        }
    }
}

fn request_title(request: &Request) -> &str {
    if request.name.trim().is_empty() {
        &request.url
    } else {
        &request.name
    }
}

fn matches_request(request: &Request, needle: &str) -> bool {
    [request_title(request), &request.method, &request.url]
        .iter()
        .any(|value| value.to_lowercase().contains(needle))
}

fn request_row(ui: &mut egui::Ui, request: &Request, selected: bool) -> bool {
    let title = request_title(request);
    ui.add(
        egui::Button::selectable(
            selected,
            RichText::new(format!("{}  {title}", request.method)).monospace(),
        )
        .truncate(),
    )
    .on_hover_text(title)
    .clicked()
}

fn query_editor(ui: &mut egui::Ui, url: &mut String) {
    let (address, fragment) = url.split_once('#').unwrap_or((url, ""));
    let (base, query) = address.split_once('?').unwrap_or((address, ""));
    let mut query = query.to_owned();
    if ui
        .add(
            TextEdit::singleline(&mut query)
                .font(egui::TextStyle::Monospace)
                .hint_text("limit=10&offset=0")
                .desired_width(f32::INFINITY),
        )
        .changed()
    {
        let mut updated = base.to_owned();
        if !query.is_empty() {
            updated.push('?');
            updated.push_str(&query);
        }
        if url.contains('#') {
            updated.push('#');
            updated.push_str(fragment);
        }
        *url = updated;
    }
}

fn edit_payload(ui: &mut egui::Ui, value: &mut String, hint: &str) {
    egui::ScrollArea::vertical()
        .id_salt("request_payload")
        .max_height(ui.available_height().max(80.0))
        .show(ui, |ui| {
            ui.add(
                TextEdit::multiline(value)
                    .code_editor()
                    .hint_text(hint)
                    .desired_width(f32::INFINITY)
                    .desired_rows(5),
            );
        });
}

impl eframe::App for Postdove {
    fn update(&mut self, ctx: &egui::Context, _: &mut eframe::Frame) {
        self.poll_response();
        egui::SidePanel::left("requests")
            .default_width(220.0)
            .width_range(168.0..=320.0)
            .show(ctx, |ui| {
                ui.add_space(6.0);
                ui.label(RichText::new("Postdove").size(23.0).strong().color(NEON));
                ui.add_space(6.0);
                self.sidebar(ui);
            });
        egui::CentralPanel::default().show(ctx, |ui| {
            self.collection_toolbar(ui);
            if self.viewing_collection {
                egui::ScrollArea::vertical()
                    .id_salt("collection_settings")
                    .show(ui, |ui| self.collection_view(ui));
                return;
            }
            self.request_bar(ui);
            ui.separator();
            if ui.available_width() >= 640.0 {
                let split = ui.available_rect_before_wrap().center().x;
                let rect = ui.available_rect_before_wrap();
                ui.painter().vline(
                    split,
                    rect.y_range(),
                    ui.visuals().widgets.noninteractive.bg_stroke,
                );
                ui.scope(|ui| {
                    ui.spacing_mut().item_spacing.x = 24.0;
                    ui.columns(2, |columns| {
                        columns[0].scope(|ui| {
                            ui.spacing_mut().item_spacing.x = 8.0;
                            self.request_editor(ui);
                        });
                        columns[1].scope(|ui| {
                            ui.spacing_mut().item_spacing.x = 8.0;
                            self.response_view(ui);
                        });
                    });
                });
            } else {
                egui::ScrollArea::vertical()
                    .id_salt("compact_workspace")
                    .show(ui, |ui| {
                        self.request_editor(ui);
                        ui.separator();
                        self.response_view(ui);
                    });
            }
        });
    }

    fn save(&mut self, storage: &mut dyn eframe::Storage) {
        eframe::set_value(storage, STORAGE_KEY, &self.saved);
        eframe::set_value(storage, COLLECTIONS_KEY, &self.collections);
    }
}

fn main() -> eframe::Result {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1140.0, 760.0])
            .with_min_inner_size([740.0, 500.0]),
        ..Default::default()
    };
    eframe::run_native(
        "Postdove",
        options,
        Box::new(|cc| Ok(Box::new(Postdove::new(cc)))),
    )
}
