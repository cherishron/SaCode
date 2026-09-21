use anyhow::{anyhow, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};

const VERIFIER_CHARSET: &[u8] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

#[derive(Debug, Clone)]
pub struct PkceChallenge {
    pub verifier: String,
    pub challenge: String,
    pub method: &'static str,
}

#[derive(Debug, Clone)]
pub struct OidcBrowserParams {
    pub state: String,
    pub nonce: String,
    pub pkce: PkceChallenge,
}

pub fn random_url_string(len: usize) -> String {
    let mut out = String::with_capacity(len);
    let mut rng = rand::thread_rng();
    let max = 256 - (256 % VERIFIER_CHARSET.len());
    while out.len() < len {
        let mut byte = [0u8; 1];
        rng.fill_bytes(&mut byte);
        let b = byte[0] as usize;
        if b >= max {
            continue; // reject to avoid modulo bias
        }
        out.push(VERIFIER_CHARSET[b % VERIFIER_CHARSET.len()] as char);
    }
    out
}

pub fn generate_pkce() -> PkceChallenge {
    // RFC 7636: verifier length 43..=128.
    let verifier = random_url_string(64);
    let challenge = s256_challenge(&verifier);
    PkceChallenge {
        verifier,
        challenge,
        method: "S256",
    }
}

pub fn generate_browser_params() -> OidcBrowserParams {
    OidcBrowserParams {
        state: random_url_string(32),
        nonce: random_url_string(32),
        pkce: generate_pkce(),
    }
}

pub fn s256_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

pub fn build_authorize_url(
    authorize_endpoint: &str,
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    nonce: &str,
    challenge: &str,
    scope: &str,
) -> Result<String> {
    let mut url = url::Url::parse(authorize_endpoint)
        .map_err(|e| anyhow!("invalid authorize endpoint {authorize_endpoint}: {e}"))?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("scope", scope)
        .append_pair("state", state)
        .append_pair("nonce", nonce)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256");
    Ok(url.to_string())
}

/// OIDC scopes requested by SaCode CLI. `offline_access` is required so sa-idp
/// issues refresh_token (product: stay-logged-in ~7 days via refresh TTL).
pub const DEFAULT_SCOPE: &str = "openid profile email phone offline_access";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifier_meets_rfc7636_charset_and_length() {
        let params = generate_browser_params();
        let v = &params.pkce.verifier;
        assert!((43..=128).contains(&v.len()));
        assert!(v
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._~".contains(c)));
        assert_eq!(params.pkce.method, "S256");
        assert!(!params.pkce.challenge.contains('='));
        assert_ne!(params.state, params.nonce);
    }

    #[test]
    fn s256_matches_known_vector() {
        // RFC 7636 appendix B style check: challenge is base64url(sha256(verifier)).
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = s256_challenge(verifier);
        // Known value from RFC 7636 appendix B.
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn authorize_url_contains_pkce_params() {
        let url = build_authorize_url(
            "https://idp.example.com/oauth/authorize",
            "sacode",
            "http://127.0.0.1:1234/callback",
            "state-abc",
            "nonce-xyz",
            "challenge-value",
            DEFAULT_SCOPE,
        )
        .unwrap();
        assert!(url.contains("client_id=sacode"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=state-abc"));
        assert!(url.contains("response_type=code"));
    }
}
