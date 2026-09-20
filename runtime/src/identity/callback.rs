use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};

pub struct CallbackServer {
    pub redirect_uri: String,
    rx: Receiver<String>,
}

/// Bind 127.0.0.1 on an ephemeral (or fixed) port and serve a single OAuth redirect.
pub fn start_callback_server(fixed_redirect: Option<&str>) -> Result<CallbackServer> {
    let listener = match fixed_redirect {
        Some(uri) => {
            let parsed =
                url::Url::parse(uri).map_err(|e| anyhow!("invalid redirect_uri {uri}: {e}"))?;
            let host = parsed
                .host_str()
                .ok_or_else(|| anyhow!("redirect_uri missing host"))?
                .to_string();
            let port = parsed.port_or_known_default().unwrap_or(80);
            let addr = format!("{host}:{port}");
            TcpListener::bind(&addr)
                .with_context(|| format!("bind OAuth callback listener at {addr}"))?
        }
        None => TcpListener::bind("127.0.0.1:0")
            .context("bind OAuth callback listener on 127.0.0.1:0")?,
    };
    let local = listener.local_addr()?;
    let redirect_uri = match fixed_redirect {
        Some(uri) => uri.to_string(),
        None => format!("http://{}/callback", local),
    };
    let (tx, rx) = mpsc::channel();
    let redirect_for_path = redirect_uri.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut reader = BufReader::new(match stream.try_clone() {
                Ok(s) => s,
                Err(_) => continue,
            });
            let mut request_line = String::new();
            if reader.read_line(&mut request_line).is_err() {
                continue;
            }
            // Drain headers.
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        if line == "\r\n" || line == "\n" {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let path = request_line
                .split_whitespace()
                .nth(1)
                .unwrap_or("/")
                .to_string();
            let callback_path = url::Url::parse(&redirect_for_path)
                .ok()
                .and_then(|u| Some(u.path().to_string()))
                .unwrap_or_else(|| "/callback".to_string());
            let is_callback =
                path.starts_with(callback_path.as_str()) || path.starts_with("/callback");
            let full_url = if path.starts_with("http") {
                path.clone()
            } else {
                // Reconstruct using redirect host:port.
                let base = redirect_for_path
                    .rsplit_once("/callback")
                    .map(|(a, _)| a.to_string())
                    .unwrap_or_else(|| format!("http://{}", local));
                format!("{base}{path}")
            };
            let body = if is_callback {
                "SaCode identity login received. You can close this window and return to the terminal."
            } else {
                "SaCode OAuth callback server is running."
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
            if is_callback {
                let _ = tx.send(full_url);
                break;
            }
        }
    });
    Ok(CallbackServer { redirect_uri, rx })
}

impl CallbackServer {
    pub fn wait_for_callback(&self, timeout: Duration) -> Result<String> {
        self.rx.recv_timeout(timeout).map_err(|_| {
            anyhow!(
                "timed out waiting for OAuth callback on {}",
                self.redirect_uri
            )
        })
    }
}

pub fn open_or_print_authorize_url(url: &str) {
    println!("Open this URL in a browser to sign in:");
    println!("{url}");
    match webbrowser::open(url) {
        Ok(()) => println!("(browser launch attempted)"),
        Err(e) => println!("(could not open browser automatically: {e}; open the URL manually)"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn callback_server_accepts_loopback_request() {
        let server = start_callback_server(None).unwrap();
        let uri = server.redirect_uri.clone();
        let handle = std::thread::spawn(move || {
            let mut stream = std::net::TcpStream::connect(
                url::Url::parse(&uri)
                    .unwrap()
                    .socket_addrs(|| None)
                    .unwrap()[0],
            )
            .unwrap();
            let req =
                format!("GET /callback?code=abc&state=xyz HTTP/1.1\r\nHost: localhost\r\n\r\n");
            stream.write_all(req.as_bytes()).unwrap();
            let mut buf = String::new();
            stream.read_to_string(&mut buf).unwrap();
            buf
        });
        let callback = server.wait_for_callback(Duration::from_secs(5)).unwrap();
        assert!(callback.contains("code=abc"));
        assert!(callback.contains("state=xyz"));
        let resp = handle.join().unwrap();
        assert!(resp.contains("200 OK"));
    }
}
