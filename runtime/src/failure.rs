use sacode_kernel::model::{ProviderFailure, ProviderRecoveryAction};
use sacode_kernel::{FailureCategory, FailureDetail, SuggestedAction};

pub fn provider_failure_detail(failure: &ProviderFailure) -> FailureDetail {
    let suggested_action = match failure.action {
        ProviderRecoveryAction::ReenterCredential | ProviderRecoveryAction::SelectModel => {
            SuggestedAction::ReconfigureProvider
        }
        ProviderRecoveryAction::CheckQuota
        | ProviderRecoveryAction::CheckNetwork
        | ProviderRecoveryAction::RetryLater => SuggestedAction::Retry,
    };
    FailureDetail {
        category: FailureCategory::Provider,
        code: failure.code.clone(),
        retryable: failure.retryable,
        suggested_action,
        safe_message: failure.safe_message.clone(),
    }
}

pub fn classify_provider_failure(error: &str) -> FailureDetail {
    let lower = error.to_ascii_lowercase();
    if contains_any(
        &lower,
        &["401", "403", "unauthorized", "forbidden", "api key"],
    ) {
        return failure(
            "provider/authentication",
            false,
            SuggestedAction::ReconfigureProvider,
            "Provider authentication failed. Check the configured credential.",
        );
    }
    if contains_any(
        &lower,
        &["429", "rate limit", "quota", "resource exhausted"],
    ) {
        return failure(
            "provider/quota_or_rate_limit",
            true,
            SuggestedAction::Retry,
            "Provider quota or rate limit was reached. Retry later or review the account quota.",
        );
    }
    if contains_any(
        &lower,
        &[
            "model not found",
            "model unavailable",
            "unknown model",
            "does not exist",
        ],
    ) {
        return failure(
            "provider/model_unavailable",
            false,
            SuggestedAction::ReconfigureProvider,
            "The selected model is unavailable. Select an accessible model.",
        );
    }
    if contains_any(
        &lower,
        &[
            "dns",
            "timeout",
            "timed out",
            "connection",
            "tls",
            "certificate",
        ],
    ) {
        return failure(
            "provider/network",
            true,
            SuggestedAction::Retry,
            "The provider could not be reached. Check the network and endpoint, then retry.",
        );
    }
    failure(
        "provider/service",
        true,
        SuggestedAction::Retry,
        "The provider returned an unexpected service error. Retry later or inspect internal logs.",
    )
}

pub fn classify_failure(category: FailureCategory, error: &str) -> FailureDetail {
    if category == FailureCategory::Provider {
        return classify_provider_failure(error);
    }
    let (code, retryable, action, message) = match category {
        FailureCategory::Permission => (
            "permission/denied",
            false,
            SuggestedAction::CheckPermissions,
            "The operation is outside the allowed permission boundary.",
        ),
        FailureCategory::Approval => (
            "approval/required",
            false,
            SuggestedAction::RequestApproval,
            "The operation requires approval before it can continue.",
        ),
        FailureCategory::Tool => (
            "tool/execution_failed",
            true,
            SuggestedAction::Retry,
            "A tool failed to complete the requested operation.",
        ),
        FailureCategory::Validation => (
            "validation/failed",
            false,
            SuggestedAction::None,
            "Validation did not pass. Review the reported checks.",
        ),
        FailureCategory::Recovery => (
            "recovery/unsafe",
            false,
            SuggestedAction::ReviewRecoverySource,
            "The saved task state cannot be restored safely.",
        ),
        FailureCategory::Compatibility => (
            "compatibility/unsupported",
            false,
            SuggestedAction::UpdateClient,
            "The client and service versions are not compatible.",
        ),
        FailureCategory::System => (
            "system/unexpected",
            false,
            SuggestedAction::ReportIssue,
            "An unexpected system error occurred. Review internal logs for details.",
        ),
        FailureCategory::Provider => unreachable!(),
    };
    FailureDetail {
        category,
        code: code.to_string(),
        retryable,
        suggested_action: action,
        safe_message: message.to_string(),
    }
}

fn failure(
    code: &str,
    retryable: bool,
    suggested_action: SuggestedAction,
    safe_message: &str,
) -> FailureDetail {
    FailureDetail {
        category: FailureCategory::Provider,
        code: code.to_string(),
        retryable,
        suggested_action,
        safe_message: safe_message.to_string(),
    }
}

fn contains_any(value: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|pattern| value.contains(pattern))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sacode_kernel::model::{ProviderFailureCategory, ProviderRecoveryAction};

    #[test]
    fn structured_provider_failure_maps_without_string_classification() {
        let detail = provider_failure_detail(&ProviderFailure {
            category: ProviderFailureCategory::ModelUnavailable,
            code: "provider/model_unavailable".to_string(),
            retryable: false,
            action: ProviderRecoveryAction::SelectModel,
            safe_message: "Select another model.".to_string(),
            retry_after_secs: None,
        });
        assert_eq!(detail.code, "provider/model_unavailable");
        assert_eq!(
            detail.suggested_action,
            SuggestedAction::ReconfigureProvider
        );
    }

    #[test]
    fn provider_failure_classifies_known_categories() {
        let cases = [
            (
                "Provider error (401): invalid API key",
                "provider/authentication",
                false,
            ),
            (
                "Provider error (429): quota exceeded",
                "provider/quota_or_rate_limit",
                true,
            ),
            ("model not found", "provider/model_unavailable", false),
            ("request timed out", "provider/network", true),
            (
                "Provider error (500): upstream unavailable",
                "provider/service",
                true,
            ),
        ];
        for (error, code, retryable) in cases {
            let detail = classify_provider_failure(error);
            assert_eq!(detail.code, code);
            assert_eq!(detail.retryable, retryable);
        }
    }

    #[test]
    fn provider_failure_does_not_expose_raw_secret() {
        let detail = classify_provider_failure("401 api key sk-test-secret-value is invalid");
        assert!(!detail.safe_message.contains("sk-test-secret-value"));
    }

    #[test]
    fn unknown_system_failure_uses_safe_fallback() {
        let detail = classify_failure(FailureCategory::System, "password=top-secret");
        assert_eq!(detail.code, "system/unexpected");
        assert!(!detail.safe_message.contains("top-secret"));
    }
}
