use super::{AuthHost, GitAuthError, GitAuthResult};

/// Git credential-helper request (stdin, one key=value per line).
#[derive(Debug, Clone)]
pub struct CredentialRequest {
    pub protocol: String,
    pub host: String,
}

pub fn parse_credential_request(raw: &str) -> CredentialRequest {
    let mut protocol = String::new();
    let mut host = String::new();
    for line in raw.lines() {
        if let Some((k, v)) = line.split_once('=') {
            match k.trim() {
                "protocol" => protocol = v.trim().to_string(),
                "host" => host = v.trim().to_string(),
                _ => {}
            }
        }
    }
    CredentialRequest { protocol, host }
}

/// Resolve host → AuthHost for token lookup.
pub fn host_for_git_host(host: &str) -> Option<AuthHost> {
    let h = host.trim().trim_start_matches("www.").to_ascii_lowercase();
    if h.contains("github.com") || h == "github" {
        return Some(AuthHost::Github);
    }
    if h.contains("gitee.com") || h == "gitee" {
        return Some(AuthHost::Gitee);
    }
    None
}

/// git credential helper reply on stdout.
pub fn credential_reply(username: &str, password: &str) -> String {
    format!("username={username}\npassword={password}\n")
}

pub fn resolve_credential(
    req: &CredentialRequest,
    user_root: Option<&Path>,
) -> GitAuthResult<Option<String>> {
    if !req.protocol.eq_ignore_ascii_case("https") {
        return Ok(None);
    }
    let Some(host) = host_for_git_host(&req.host) else {
        return Ok(None);
    };
    super::store::token_for_host(host, user_root)
}

/// Username for token-based HTTPS git auth (token as password).
pub fn username_for_host(host: AuthHost) -> &'static str {
    match host {
        // GitHub accepts any non-empty username with PAT; use x-access-token for GHES-style too.
        AuthHost::Github => "x-access-token",
        AuthHost::Gitee => "oauth2",
    }
}

pub fn emit_credential(req_raw: &str, user_root: Option<&Path>) -> GitAuthResult<()> {
    let req = parse_credential_request(req_raw);
    let Some(host) = host_for_git_host(&req.host) else {
        // Exit quietly — git also consults other helpers.
        return Ok(());
    };
    let token = super::store::token_for_host(host, user_root)?.ok_or_else(|| {
        GitAuthError::msg(format!(
            "no {} token stored; run: sacode git auth login {}",
            host.as_str(),
            host.as_str()
        ))
    })?;
    print!("{}", credential_reply(username_for_host(host), &token));
    Ok(())
}

use std::path::Path;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git_auth::store::{logout_host, save_token};

    #[test]
    fn parse_and_emit_github_credential() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        save_token(AuthHost::Github, "tok-github-1", "token", None, Some(root)).unwrap();
        let req = parse_credential_request("protocol=https\nhost=github.com\n\n");
        assert_eq!(req.host, "github.com");
        let token = resolve_credential(&req, Some(root))
            .unwrap()
            .expect("token");
        assert_eq!(token, "tok-github-1");
        assert!(credential_reply("x-access-token", &token).contains("password=tok-github-1"));
        logout_host(None, Some(root)).unwrap();
    }

    #[test]
    fn ssh_protocol_yields_no_token() {
        let req = parse_credential_request("protocol=ssh\ngithub.com");
        assert!(resolve_credential(&req, None).unwrap().is_none());
    }
}
