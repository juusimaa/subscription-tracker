# The currencies a subscription can be billed in: exactly the ones the
# European Central Bank publishes a daily reference rate for, plus the euro
# those rates are quoted against (PLAN.md milestone 10).
#
# A constant rather than something fetched, so validating a subscription
# never touches the network. The list changes rarely and visibly -- the ECB
# drops a currency when its country joins the euro (HRK in 2023, BGN in
# 2026) or when it suspends one (RUB in 2022) -- and a change here is a
# one-line edit.

CURRENCIES: frozenset[str] = frozenset(
    {
        "EUR",
        "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "GBP", "HKD", "HUF",
        "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR", "NOK", "NZD",
        "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
    }
)

DEFAULT_CURRENCY = "EUR"


def normalize(code: str) -> str:
    """The stored spelling of a currency code, or ValueError if this app
    cannot convert it. Case and surrounding space are forgiven, because a
    hand-edited backup saying " usd" means USD."""
    normalized = code.strip().upper()
    if normalized not in CURRENCIES:
        raise ValueError(
            f"Unsupported currency {code!r}; use one of the ECB reference "
            f"currencies: {', '.join(sorted(CURRENCIES))}"
        )
    return normalized
