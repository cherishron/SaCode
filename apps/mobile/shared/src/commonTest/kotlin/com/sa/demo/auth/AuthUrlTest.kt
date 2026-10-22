package com.sa.demo.auth

import com.sa.demo.env.SaaiEnv
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AuthUrlTest {

    @Test
    fun authorize_url_contains_pkce_and_client() {
        val env = SaaiEnv.Dev
        val pkce = Pkce(
            verifier = "test-verifier",
            challenge = "test-challenge",
            state = "test-state",
        )
        val url = AuthRepository.buildAuthorizeUrl(env, pkce)
        assertTrue(url.startsWith("http://127.0.0.1:8080/oauth/authorize?"))
        assertTrue(url.contains("client_id=saapp"))
        assertTrue(url.contains("code_challenge=test-challenge"))
        assertTrue(url.contains("code_challenge_method=S256"))
        assertTrue(url.contains("state=test-state"))
        assertTrue(url.contains("redirect_uri="))
        assertTrue(url.contains("response_type=code"))
    }

    @Test
    fun dev_env_contract_matches_product_line() {
        val env = SaaiEnv.Dev
        assertEquals("saapp", env.clientId)
        assertEquals("saapp://oauth/callback", env.redirectUri)
        assertEquals("http://127.0.0.1:8080/oauth/token", env.tokenUrl)
        assertEquals("http://127.0.0.1:8090/api/auth/exchange", env.exchangeUrl)
        assertEquals("http://127.0.0.1:8090/v1/models", env.modelsUrl)
    }
}
