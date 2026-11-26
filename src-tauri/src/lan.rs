use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rcgen::{CertifiedKey, generate_simple_self_signed};
use rustls::{
    CertificateError, DigitallySignedStruct, DistinguishedName, RootCertStore, SignatureScheme,
    client::danger::HandshakeSignatureValid,
    crypto::{WebPkiSupportedAlgorithms, verify_tls13_signature},
    pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime},
    server::danger::{ClientCertVerified, ClientCertVerifier},
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;
use tauri::State;
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{Mutex, Semaphore},
    task::JoinHandle,
    time::timeout,
};
use tokio_rustls::{TlsAcceptor, TlsConnector};

const SERVER_NAME: &str = "postdove.lan";
const DEFAULT_PORT: u16 = 46329;
const PIN_LIFETIME: Duration = Duration::from_secs(120);
const MAX_ATTEMPTS: u8 = 5;
const IO_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_REQUEST: usize = 2048;
const MAX_REPLY: usize = 4 * 1024 * 1024;
const INVITE_PREFIX: &str = "postdove-lan-v1.";

#[derive(Serialize, Deserialize)]
struct Identity {
    certificate: Vec<u8>,
    key: Vec<u8>,
}

impl Identity {
    fn new() -> Result<Self, String> {
        let CertifiedKey { cert, signing_key } =
            generate_simple_self_signed(vec![SERVER_NAME.into()])
                .map_err(|error| error.to_string())?;
        Ok(Self {
            certificate: cert.der().to_vec(),
            key: signing_key.serialize_der(),
        })
    }

    fn tls_identity(&self) -> (Vec<CertificateDer<'static>>, PrivateKeyDer<'static>) {
        (
            vec![CertificateDer::from(self.certificate.clone())],
            PrivatePkcs8KeyDer::from(self.key.clone()).into(),
        )
    }
}

#[derive(Debug)]
struct PairingVerifier {
    algorithms: WebPkiSupportedAlgorithms,
}

impl ClientCertVerifier for PairingVerifier {
    fn root_hint_subjects(&self) -> &[DistinguishedName] {
        &[]
    }

    fn verify_client_cert(
        &self,
        certificate: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        _: UnixTime,
    ) -> Result<ClientCertVerified, rustls::Error> {
        if certificate.is_empty() || certificate.len() > 4096 || !intermediates.is_empty() {
            return Err(rustls::Error::InvalidCertificate(
                CertificateError::BadEncoding,
            ));
        }
        // Admission happens in the PIN/token protocol. TLS still has to verify
        // CertificateVerify, which proves possession of this certificate's key.
        Ok(ClientCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _: &[u8],
        _: &CertificateDer<'_>,
        _: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Err(rustls::Error::General(
            "Postdove LAN requires TLS 1.3".into(),
        ))
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, certificate, signature, &self.algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algorithms.supported_schemes()
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Invite {
    address: SocketAddr,
    certificate: Vec<u8>,
    fingerprint: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct Viewer {
    invite: Invite,
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    invitation: String,
    pin: String,
    fingerprint: String,
    expires_in_seconds: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanStatus {
    suggested_address: String,
    host_address: Option<String>,
    viewer_address: Option<String>,
    viewer_fingerprint: Option<String>,
    paired_devices: usize,
}

struct Pin {
    code: String,
    expires: Instant,
    attempts: u8,
}

struct ActiveHost {
    address: SocketAddr,
    generation: u64,
    task: JoinHandle<()>,
    pin: Option<Pin>,
}

#[derive(Default)]
struct Host {
    generation: u64,
    running: Option<ActiveHost>,
    peers: BTreeMap<String, [u8; 32]>,
}

pub struct Lan {
    directory: PathBuf,
    workspace: PathBuf,
    identity: Identity,
    host: Mutex<Host>,
    viewer: Mutex<Option<Viewer>>,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
enum Message {
    Pair { pin: String },
    Read { token: String },
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "result", rename_all = "snake_case")]
enum Reply {
    Paired { token: String },
    Workspace { workspace: Value },
    Denied { message: String },
}

impl Lan {
    pub fn load(directory: PathBuf, workspace: PathBuf) -> Result<Arc<Self>, String> {
        let identity_file = directory.join("identity.json");
        let identity = match read_json(&identity_file)? {
            Some(identity) => identity,
            None => {
                let identity = Identity::new()?;
                crate::write_json(&identity_file, &identity)?;
                identity
            }
        };
        let peers = read_json(&directory.join("peers.json"))?.unwrap_or_default();
        let viewer = read_json::<Option<Viewer>>(&directory.join("viewer.json"))?.flatten();
        Ok(Arc::new(Self {
            directory,
            workspace,
            identity,
            host: Mutex::new(Host {
                peers,
                ..Host::default()
            }),
            viewer: Mutex::new(viewer),
        }))
    }

    async fn start(self: &Arc<Self>, address: SocketAddr) -> Result<Offer, String> {
        if !allowed_address(address.ip()) {
            return Err("Use a private LAN address or 127.0.0.1.".into());
        }
        let mut host = self.host.lock().await;
        if let Some(running) = host.running.as_ref()
            && running.address != address
        {
            return Err("Stop sharing before changing the LAN address.".into());
        }
        if host.running.is_none() {
            let listener = TcpListener::bind(address)
                .await
                .map_err(|error| format!("Could not listen on LAN: {error}"))?;
            let port = listener
                .local_addr()
                .map_err(|error| error.to_string())?
                .port();
            let address = SocketAddr::new(address.ip(), port);
            let provider = rustls::crypto::ring::default_provider();
            let verifier = PairingVerifier {
                algorithms: provider.signature_verification_algorithms,
            };
            let (certificate, key) = self.identity.tls_identity();
            let config = rustls::ServerConfig::builder_with_provider(Arc::new(provider))
                .with_protocol_versions(&[&rustls::version::TLS13])
                .map_err(|error| error.to_string())?
                .with_client_cert_verifier(Arc::new(verifier))
                .with_single_cert(certificate, key)
                .map_err(|error| error.to_string())?;
            host.generation = host.generation.wrapping_add(1);
            let generation = host.generation;
            let lan = self.clone();
            let task = tokio::spawn(async move {
                lan.listen(listener, TlsAcceptor::from(Arc::new(config)), generation)
                    .await
            });
            host.running = Some(ActiveHost {
                address,
                generation,
                task,
                pin: None,
            });
        }
        let running = host.running.as_mut().expect("active LAN listener");
        let pin = new_pin()?;
        running.pin = Some(Pin {
            code: pin.clone(),
            expires: Instant::now() + PIN_LIFETIME,
            attempts: 0,
        });
        let fingerprint = fingerprint(&self.identity.certificate);
        let invite = Invite {
            address: running.address,
            certificate: self.identity.certificate.clone(),
            fingerprint: fingerprint.clone(),
        };
        let encoded = serde_json::to_vec(&invite).map_err(|error| error.to_string())?;
        Ok(Offer {
            invitation: format!("{INVITE_PREFIX}{}", URL_SAFE_NO_PAD.encode(encoded)),
            pin,
            fingerprint,
            expires_in_seconds: PIN_LIFETIME.as_secs(),
        })
    }

    async fn listen(
        self: Arc<Self>,
        listener: TcpListener,
        acceptor: TlsAcceptor,
        generation: u64,
    ) {
        let slots = Arc::new(Semaphore::new(16));
        while let Ok((stream, remote)) = listener.accept().await {
            if !allowed_address(remote.ip()) {
                continue;
            }
            let Ok(slot) = slots.clone().try_acquire_owned() else {
                continue;
            };
            let lan = self.clone();
            let acceptor = acceptor.clone();
            tokio::spawn(async move {
                let _slot = slot;
                let _ = timeout(IO_TIMEOUT, async {
                    let mut stream = acceptor
                        .accept(stream)
                        .await
                        .map_err(|error| error.to_string())?;
                    let client = stream
                        .get_ref()
                        .1
                        .peer_certificates()
                        .and_then(|chain| chain.first())
                        .ok_or("Missing viewer certificate.")?;
                    let peer = fingerprint(client.as_ref());
                    let message = read_frame(&mut stream, MAX_REQUEST).await?;
                    let reply = lan.handle(generation, &peer, message).await;
                    write_frame(&mut stream, &reply, MAX_REPLY).await
                })
                .await;
            });
        }
    }

    async fn handle(&self, generation: u64, peer: &str, message: Message) -> Reply {
        let mut host = self.host.lock().await;
        let Some(running) = host
            .running
            .as_mut()
            .filter(|running| running.generation == generation)
        else {
            return denied("Sharing is stopped.");
        };
        match message {
            Message::Pair { pin } => {
                let Some(challenge) = running.pin.as_mut().filter(|challenge| {
                    challenge.expires > Instant::now() && challenge.attempts < MAX_ATTEMPTS
                }) else {
                    return denied("PIN expired or locked. Generate a new PIN on the host.");
                };
                challenge.attempts += 1;
                if !bool::from(challenge.code.as_bytes().ct_eq(pin.as_bytes())) {
                    return denied("Pairing PIN is incorrect.");
                }
                let token = match random::<32>() {
                    Ok(bytes) => URL_SAFE_NO_PAD.encode(bytes),
                    Err(error) => return denied(&error),
                };
                let mut peers = host.peers.clone();
                peers.insert(peer.to_owned(), token_digest(&token));
                if let Err(error) = crate::write_json(&self.directory.join("peers.json"), &peers) {
                    return denied(&format!("Could not save the pairing: {error}"));
                }
                host.peers = peers;
                if let Some(running) = host.running.as_mut() {
                    running.pin = None;
                }
                Reply::Paired { token }
            }
            Message::Read { token } => {
                let valid = host
                    .peers
                    .get(peer)
                    .is_some_and(|expected| bool::from(expected.ct_eq(&token_digest(&token))));
                if !valid {
                    return denied("Viewer authorization failed. Pair again on the host.");
                }
                match self.snapshot() {
                    Ok(workspace) => Reply::Workspace { workspace },
                    Err(error) => denied(&error),
                }
            }
        }
    }

    fn snapshot(&self) -> Result<Value, String> {
        let workspace: Value = read_json(&self.workspace)?.unwrap_or_else(|| json!({}));
        Ok(public_snapshot(&workspace, |folder| folder["lanShared"] == true))
    }

    async fn request(&self, invite: &Invite, message: &Message) -> Result<Reply, String> {
        verify_invite(invite)?;
        let mut roots = RootCertStore::empty();
        roots
            .add(CertificateDer::from(invite.certificate.clone()))
            .map_err(|error| error.to_string())?;
        let (certificate, key) = self.identity.tls_identity();
        let config = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|error| error.to_string())?
        .with_root_certificates(roots)
        .with_client_auth_cert(certificate, key)
        .map_err(|error| error.to_string())?;
        timeout(IO_TIMEOUT, async {
            let socket = TcpStream::connect(invite.address)
                .await
                .map_err(|error| format!("Could not reach {}: {error}", invite.address))?;
            let name = ServerName::try_from(SERVER_NAME).map_err(|error| error.to_string())?;
            let mut stream = TlsConnector::from(Arc::new(config))
                .connect(name, socket)
                .await
                .map_err(|error| format!("Host TLS verification failed: {error}"))?;
            let certificate = stream
                .get_ref()
                .1
                .peer_certificates()
                .and_then(|chain| chain.first())
                .ok_or("Host did not present a certificate.")?;
            if certificate.as_ref() != invite.certificate {
                return Err(
                    "Host certificate changed. Obtain a new invitation from the host.".into(),
                );
            }
            write_frame(&mut stream, message, MAX_REQUEST).await?;
            match read_frame(&mut stream, MAX_REPLY).await? {
                Reply::Denied { message } => Err(message),
                reply => Ok(reply),
            }
        })
        .await
        .map_err(|_| "LAN request timed out.".to_owned())?
    }
}

pub(crate) fn public_snapshot(workspace: &Value, shared: impl Fn(&Value) -> bool) -> Value {
    let published: Vec<_> = workspace["folders"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|folder| folder["id"].is_string() && folder["name"].is_string() && shared(folder))
        .collect();
    let ids: std::collections::HashSet<_> = published
        .iter()
        .filter_map(|folder| folder["id"].as_str())
        .collect();
    let folders: Vec<_> = published.iter().map(|folder| {
        let parent = folder["desktopParent"].as_str().filter(|id| ids.contains(id));
        json!({"id": folder["id"], "name": folder["name"], "desktopParent": parent})
    }).collect();
    let requests: Vec<_> = workspace["requests"].as_array().into_iter().flatten()
        .filter(|request| request["id"].is_string() && request["name"].is_string()
            && request["method"].is_string()
            && request["folderId"].as_str().is_some_and(|id| ids.contains(id)))
        .map(|request| {
        let names = |field: &str| request[field].as_array().into_iter().flatten()
            .filter(|item| item["enabled"] == true)
            .filter_map(|item| item["key"].as_str()).collect::<Vec<_>>();
        let url = request["url"].as_str().unwrap_or_default().split(['?', '#']).next().unwrap_or_default();
        let url = match url.split_once("://") {
            Some((scheme, rest)) => {
                let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
                let host = authority.rsplit('@').next().unwrap_or_default();
                if path.is_empty() { format!("{scheme}://{host}") } else { format!("{scheme}://{host}/{path}") }
            }
            None => url.to_owned(),
        };
        json!({
            "id": request["id"], "folderId": request["folderId"], "name": request["name"],
            "method": request["method"], "url": url, "headers": names("headers"), "parameters": names("params"),
        })
    }).collect();
    json!({"folders": folders, "requests": requests})
}

fn denied(message: &str) -> Reply {
    Reply::Denied {
        message: message.to_owned(),
    }
}

fn allowed_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
        IpAddr::V6(ip) => ip
            .to_ipv4_mapped()
            .map_or(ip.is_loopback() || ip.is_unique_local(), |ip| {
                allowed_address(ip.into())
            }),
    }
}

fn suggested_address() -> SocketAddr {
    UdpSocket::bind("0.0.0.0:0")
        .ok()
        .and_then(|socket| {
            socket.connect("192.0.2.1:9").ok()?;
            socket
                .local_addr()
                .ok()
                .map(|local| local.ip())
                .filter(|ip| allowed_address(*ip))
        })
        .map_or(
            SocketAddr::from((Ipv4Addr::LOCALHOST, DEFAULT_PORT)),
            |ip| SocketAddr::new(ip, DEFAULT_PORT),
        )
}

fn random<const SIZE: usize>() -> Result<[u8; SIZE], String> {
    let mut bytes = [0; SIZE];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes)
}

fn new_pin() -> Result<String, String> {
    loop {
        let value = u32::from_be_bytes(random()?);
        if value < 4_294_000_000 {
            return Ok(format!("{:06}", value % 1_000_000));
        }
    }
}

fn fingerprint(certificate: &[u8]) -> String {
    format!("{:x}", Sha256::digest(certificate))
}

fn token_digest(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

fn verify_invite(invite: &Invite) -> Result<(), String> {
    if !allowed_address(invite.address.ip()) || invite.address.port() == 0 {
        return Err("The invitation does not point to a private LAN or loopback address.".into());
    }
    if invite.certificate.is_empty()
        || invite.certificate.len() > 4096
        || fingerprint(&invite.certificate) != invite.fingerprint
    {
        return Err("Invitation certificate fingerprint is invalid.".into());
    }
    Ok(())
}

fn decode_invite(text: &str) -> Result<Invite, String> {
    let encoded = text
        .trim()
        .strip_prefix(INVITE_PREFIX)
        .filter(|text| text.len() <= 32768)
        .ok_or("Invalid Postdove LAN invitation.")?;
    let data = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| "Invalid invitation encoding.")?;
    let invite = serde_json::from_slice(&data).map_err(|_| "Invalid invitation fields.")?;
    verify_invite(&invite)?;
    Ok(invite)
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

async fn read_frame<T: DeserializeOwned>(
    reader: &mut (impl AsyncRead + Unpin),
    limit: usize,
) -> Result<T, String> {
    let size = reader.read_u32().await.map_err(|error| error.to_string())? as usize;
    if size == 0 || size > limit {
        return Err("Invalid LAN message size.".into());
    }
    let mut data = vec![0; size];
    reader
        .read_exact(&mut data)
        .await
        .map_err(|error| error.to_string())?;
    serde_json::from_slice(&data).map_err(|_| "Invalid LAN message.".into())
}

async fn write_frame(
    writer: &mut (impl AsyncWrite + Unpin),
    data: &impl Serialize,
    limit: usize,
) -> Result<(), String> {
    let data = serde_json::to_vec(data).map_err(|error| error.to_string())?;
    if data.len() > limit {
        return Err("The LAN response exceeds its size limit.".into());
    }
    writer
        .write_u32(data.len() as u32)
        .await
        .map_err(|error| error.to_string())?;
    writer
        .write_all(&data)
        .await
        .map_err(|error| error.to_string())?;
    writer.flush().await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn lan_status(lan: State<'_, Arc<Lan>>) -> Result<LanStatus, String> {
    let host = lan.host.lock().await;
    let viewer = lan.viewer.lock().await;
    Ok(LanStatus {
        suggested_address: suggested_address().to_string(),
        host_address: host.running.as_ref().map(|host| host.address.to_string()),
        viewer_address: viewer
            .as_ref()
            .map(|viewer| viewer.invite.address.to_string()),
        viewer_fingerprint: viewer
            .as_ref()
            .map(|viewer| viewer.invite.fingerprint.clone()),
        paired_devices: host.peers.len(),
    })
}

#[tauri::command]
pub async fn lan_host_start(lan: State<'_, Arc<Lan>>, address: String) -> Result<Offer, String> {
    let mut address: SocketAddr = address
        .trim()
        .parse()
        .map_err(|_| "Enter an IP address and port, such as 192.168.1.10:46329.")?;
    if address.port() == 0 {
        address.set_port(DEFAULT_PORT);
    }
    lan.inner().start(address).await
}

#[tauri::command]
pub async fn lan_host_stop(lan: State<'_, Arc<Lan>>) -> Result<(), String> {
    let mut host = lan.host.lock().await;
    if let Some(running) = host.running.take() {
        running.task.abort();
        let _ = running.task.await;
    }
    Ok(())
}

#[tauri::command]
pub async fn lan_revoke(lan: State<'_, Arc<Lan>>) -> Result<(), String> {
    let mut host = lan.host.lock().await;
    let peers = BTreeMap::<String, [u8; 32]>::new();
    crate::write_json(&lan.directory.join("peers.json"), &peers)?;
    host.peers = peers;
    if let Some(running) = host.running.as_mut() {
        running.pin = None;
    }
    Ok(())
}

#[tauri::command]
pub fn lan_invite_info(invitation: String) -> Result<(String, String), String> {
    let invite = decode_invite(&invitation)?;
    Ok((invite.address.to_string(), invite.fingerprint))
}

#[tauri::command]
pub async fn lan_pair(
    lan: State<'_, Arc<Lan>>,
    invitation: String,
    pin: String,
) -> Result<(), String> {
    if pin.len() != 6 || !pin.bytes().all(|digit| digit.is_ascii_digit()) {
        return Err("Enter the six-digit PIN displayed on the host.".into());
    }
    let invite = decode_invite(&invitation)?;
    let Reply::Paired { token } = lan.request(&invite, &Message::Pair { pin }).await? else {
        return Err("Unexpected pairing reply.".into());
    };
    let viewer = Viewer { invite, token };
    let mut saved = lan.viewer.lock().await;
    crate::write_json(&lan.directory.join("viewer.json"), &viewer)?;
    *saved = Some(viewer);
    Ok(())
}

#[tauri::command]
pub async fn lan_read(lan: State<'_, Arc<Lan>>) -> Result<Value, String> {
    let viewer = lan
        .viewer
        .lock()
        .await
        .clone()
        .ok_or("Pair with a host first.")?;
    match lan
        .request(
            &viewer.invite,
            &Message::Read {
                token: viewer.token,
            },
        )
        .await?
    {
        Reply::Workspace { workspace } => Ok(workspace),
        _ => Err("Unexpected workspace reply.".into()),
    }
}

#[tauri::command]
pub async fn lan_forget(lan: State<'_, Arc<Lan>>) -> Result<(), String> {
    let mut viewer = lan.viewer.lock().await;
    crate::write_json(&lan.directory.join("viewer.json"), &Option::<Viewer>::None)?;
    *viewer = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lan_pairing_requires_the_pin_and_binds_read_access_to_the_viewer_certificate() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path().join("studio-workspace.json");
        crate::write_json(&workspace, &json!({
            "folders": [
                {"id":"demo","name":"Demo","desktopParent":"private-parent","lanShared":true},
                {"id":"private-parent","name":"Private parent"},
                {"id":"private-child","name":"Private child","desktopParent":"demo","lanShared":false}
            ],
            "requests": [{"id":"r","folderId":"demo","name":"Health","method":"GET",
                "url":"https://user:password@example.com/health?token=hidden",
                "bodyContent":"private body","headers":[{"key":"Authorization","value":"secret","enabled":true}],
                "params":[{"key":"token","value":"secret","enabled":true}]},
                {"id":"private-request","folderId":"private-child","name":"Private request","url":"https://example.com/private"}],
            "environments": [{"name":"private","variables":[{"currentValue":"secret"}]}]
        })).unwrap();
        let host = Lan::load(directory.path().join("host"), workspace.clone()).unwrap();
        let viewer = Lan::load(directory.path().join("viewer"), PathBuf::new()).unwrap();
        let other = Lan::load(directory.path().join("other"), PathBuf::new()).unwrap();
        let offer = host.start("127.0.0.1:0".parse().unwrap()).await.unwrap();
        let invite = decode_invite(&offer.invitation).unwrap();

        let mut impostor = invite.clone();
        impostor.certificate = other.identity.certificate.clone();
        impostor.fingerprint = fingerprint(&impostor.certificate);
        assert!(
            viewer
                .request(
                    &impostor,
                    &Message::Pair {
                        pin: offer.pin.clone()
                    }
                )
                .await
                .is_err()
        );

        let wrong_pin = if offer.pin == "000000" {
            "111111"
        } else {
            "000000"
        };
        assert!(
            viewer
                .request(
                    &invite,
                    &Message::Pair {
                        pin: wrong_pin.into()
                    }
                )
                .await
                .is_err()
        );
        let Reply::Paired { token } = viewer
            .request(
                &invite,
                &Message::Pair {
                    pin: offer.pin.clone(),
                },
            )
            .await
            .unwrap()
        else {
            panic!("viewer was not paired")
        };
        assert!(
            other
                .request(&invite, &Message::Pair { pin: offer.pin })
                .await
                .is_err()
        );
        assert!(
            other
                .request(
                    &invite,
                    &Message::Read {
                        token: token.clone()
                    }
                )
                .await
                .is_err()
        );

        let persisted: BTreeMap<String, [u8; 32]> = read_json(&host.directory.join("peers.json"))
            .unwrap()
            .unwrap();
        assert_eq!(
            persisted.get(&fingerprint(&viewer.identity.certificate)),
            Some(&token_digest(&token))
        );

        let Reply::Workspace {
            workspace: snapshot,
        } = viewer
            .request(
                &invite,
                &Message::Read {
                    token: token.clone(),
                },
            )
            .await
            .unwrap()
        else {
            panic!("viewer did not receive a snapshot")
        };
        assert_eq!(snapshot["requests"][0]["url"], "https://example.com/health");
        assert_eq!(snapshot["folders"], json!([{"id":"demo","name":"Demo","desktopParent":null}]));
        assert_eq!(snapshot["requests"].as_array().unwrap().len(), 1);
        assert_eq!(snapshot["requests"][0]["headers"], json!(["Authorization"]));
        assert_eq!(snapshot["requests"][0]["parameters"], json!(["token"]));
        let wire = snapshot.to_string();
        for private in [
            "private body",
            "password",
            "secret",
            "environments",
            "hidden",
        ] {
            assert!(!wire.contains(private));
        }
        assert!(
            serde_json::from_value::<Message>(
                json!({"operation":"write","token":token,"workspace":{}})
            )
            .is_err()
        );

        crate::write_json(
            &workspace,
            &json!({
                "folders":[{"id":"demo","name":"Demo","lanShared":false},
                    {"id":"new","name":"Newly shared","lanShared":true}],
                "requests":[{"id":"r","folderId":"demo","name":"Health"},
                    {"id":"r2","folderId":"new","name":"Status","method":"GET"}]
            }),
        )
        .unwrap();
        let Reply::Workspace { workspace } = viewer
            .request(
                &invite,
                &Message::Read {
                    token: token.clone(),
                },
            )
            .await
            .unwrap()
        else {
            panic!("viewer did not get the updated workspace")
        };
        assert_eq!(workspace["folders"].as_array().unwrap().len(), 1);
        assert_eq!(workspace["folders"][0]["name"], "Newly shared");
        assert_eq!(workspace["requests"].as_array().unwrap().len(), 1);
        assert_eq!(workspace["requests"][0]["name"], "Status");

        let reloaded = Lan::load(directory.path().join("host"), host.workspace.clone()).unwrap();
        let restarted = reloaded.host.lock().await;
        assert!(
            restarted
                .peers
                .contains_key(&fingerprint(&viewer.identity.certificate))
        );
        drop(restarted);
        let mut state = host.host.lock().await;
        state.peers.clear();
        drop(state);
        assert!(
            viewer
                .request(&invite, &Message::Read { token })
                .await
                .is_err()
        );
        host.host.lock().await.running.take().unwrap().task.abort();
    }

    #[test]
    fn pairing_pin_is_always_six_decimal_digits() {
        for _ in 0..20 {
            let pin = new_pin().unwrap();
            assert_eq!(pin.len(), 6);
            assert!(pin.bytes().all(|digit| digit.is_ascii_digit()));
        }
    }
}
