class SangriaSDKError(Exception):
    pass


class APIError(SangriaSDKError):
    def __init__(self, message: str, status_code: int | None = None, payload: dict | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload or {}


class PaymentRequiredError(SangriaSDKError):
    def __init__(self, challenge_headers: dict[str, str]):
        super().__init__("Payment required")
        self.challenge_headers = challenge_headers


class SettlementFailedError(SangriaSDKError):
    def __init__(self, message: str, reason: str | None = None):
        super().__init__(message)
        self.reason = reason
