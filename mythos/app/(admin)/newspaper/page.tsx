"use client";

import { useState, useCallback, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Article data
// ---------------------------------------------------------------------------

interface Article {
  slug: string;
  section: string;
  headline: string;
  byline: string;
  date: string;
  teaser: string;
  body: string;
  premium: boolean;
  col?: "wide" | "normal";
}

const ARTICLES: Article[] = [
  {
    slug: "fed-rates",
    section: "Economy",
    headline: "Federal Reserve Holds Rates Steady Amid Inflation Uncertainty",
    byline: "By Eleanor Marsh",
    date: "April 12, 2026",
    teaser:
      "The Federal Open Market Committee voted unanimously on Wednesday to keep the benchmark interest rate at its current range, citing mixed signals from the labor market and persistent core inflation.",
    body: `The Federal Open Market Committee voted unanimously on Wednesday to keep the benchmark interest rate at its current range, citing mixed signals from the labor market and persistent core inflation.

Chair Jerome Powell acknowledged the difficulty of the current moment in a press conference following the decision. "We are seeing a labor market that remains resilient, but inflation is proving more stubborn than we anticipated," Powell said. "We believe the current stance of monetary policy is appropriate."

Markets had widely expected the hold, though some analysts had speculated about a possible quarter-point cut given recent cooling in housing prices. Treasury yields fell slightly after the announcement, and the S&P 500 closed up 0.4% on the day.

The committee's next meeting is scheduled for June, when updated economic projections will be released. Several regional Fed presidents indicated they would need to see at least two more months of favorable inflation data before supporting a cut.`,
    premium: false,
    col: "wide",
  },
  {
    slug: "ai-regulation",
    section: "Technology",
    headline: "Senate Panel Advances Landmark AI Liability Bill",
    byline: "By Marcus Chen",
    date: "April 12, 2026",
    teaser:
      "A bipartisan Senate committee approved sweeping legislation Thursday that would hold AI developers legally responsible for foreseeable harms caused by their systems.",
    body: `A bipartisan Senate committee approved sweeping legislation Thursday that would hold AI developers legally responsible for foreseeable harms caused by their systems, setting the stage for a full chamber vote as early as next month.

The bill, co-sponsored by Senators Dana Holloway (D-CA) and Robert Fisch (R-TX), passed committee 11–4 after months of debate over how to balance innovation incentives against public safety. The legislation carves out liability safe harbors for open-source models and requires large AI companies to register "high-risk" systems with a newly created federal agency.

Industry groups were swift to push back. The Chamber of Commerce said the bill would "chill AI investment and drive development offshore." But consumer advocates praised it as overdue.

The White House has not formally committed to signing the bill but issued a statement calling it "a serious step forward in responsible AI governance."`,
    premium: false,
  },
  {
    slug: "climate-summit",
    section: "World",
    headline: "G7 Nations Pledge to Triple Renewable Energy Capacity by 2030",
    byline: "By Sofia Andrade",
    date: "April 12, 2026",
    teaser:
      "Leaders from the world's seven largest economies announced an ambitious joint commitment Friday to triple installed renewable energy capacity within four years.",
    body: `Leaders from the world's seven largest economies announced an ambitious joint commitment Friday to triple installed renewable energy capacity within four years, a pledge that analysts say would require unprecedented levels of investment in solar, wind, and grid infrastructure.

The announcement came on the final day of the G7 summit in Turin, Italy, and was framed as a direct response to warnings from the International Energy Agency that current decarbonization efforts remain far off track.

"The science is clear and the economics are increasingly favorable," said German Chancellor Katrin Müller. "What has been missing is the political will. Today, we are providing it."

Critics noted that similar pledges have been made before without sufficient follow-through. Details about financing mechanisms and enforcement will be worked out in a technical working group that reports back in September.`,
    premium: false,
  },
  {
    slug: "crypto-payments",
    section: "Finance",
    headline:
      "Stablecoin Payments Cross $10 Trillion in Annual Volume — What Comes Next",
    byline: "By James Okafor",
    date: "April 12, 2026",
    teaser:
      "On-chain stablecoin transactions surpassed $10 trillion in annualized volume this quarter for the first time, according to new data from Chainalysis — eclipsing Visa's total payment volume.",
    body: `On-chain stablecoin transactions surpassed $10 trillion in annualized volume this quarter for the first time, according to new data from Chainalysis — eclipsing Visa's total payment volume and marking a symbolic inflection point in the maturation of crypto-native finance.

USDC alone accounted for $4.2 trillion of that figure, driven in part by a new generation of HTTP-native payment protocols that allow applications to charge for API access and content without traditional payment rails.

The x402 protocol, developed by Coinbase and now supported by a growing ecosystem of SDKs, embeds payment requirements directly into HTTP responses. A server can respond with a 402 status code and cryptographic payment requirements; the client signs an ERC-3009 authorization and retries — the whole flow completing in under two seconds with no card networks, no chargebacks, and no monthly fees.

"We're watching the plumbing of the internet get rebuilt in real time," said Sangria co-founder Jared Palmer. "Every API, every article, every data feed — they can all have native economic primitives. That's genuinely new."

Traditional payment processors have taken notice. Stripe announced a USDC settlement option for merchants in February; PayPal expanded its PYUSD stablecoin to developers via a REST API last month. The race to own the infrastructure layer of machine-to-machine commerce is intensifying.`,
    premium: true,
    col: "wide",
  },
  {
    slug: "biotech-breakthrough",
    section: "Science",
    headline:
      "CRISPR Trial Shows Complete Remission in Aggressive Blood Cancer",
    byline: "By Dr. Priya Nair",
    date: "April 12, 2026",
    teaser:
      "A Phase II clinical trial of a CRISPR-based therapy achieved complete remission in 87% of patients with relapsed or refractory acute myeloid leukemia, researchers reported Thursday.",
    body: `A Phase II clinical trial of a CRISPR-based therapy achieved complete remission in 87% of patients with relapsed or refractory acute myeloid leukemia — one of the deadliest blood cancers — researchers reported Thursday in the New England Journal of Medicine.

The therapy, developed by Beam Therapeutics in partnership with Massachusetts General Hospital, uses base editing rather than traditional CRISPR-Cas9 cuts, reducing off-target effects that have plagued earlier gene-editing approaches. Patients received a single infusion; median follow-up is now 18 months with no detected relapses among the remission cohort.

"These are patients who had exhausted every standard option," said lead investigator Dr. Kenji Watanabe. "To see durable remissions at this rate is something we hadn't dared to hope for even three years ago."

The FDA granted the therapy Breakthrough Therapy designation last year. A Phase III trial is expected to begin enrollment in the third quarter, with a potential approval filing as early as 2028.`,
    premium: true,
  },
];

// ---------------------------------------------------------------------------
// Payment step types
// ---------------------------------------------------------------------------

type StepStatus = "idle" | "pending" | "done" | "error";

interface NegotiateData {
  amountUsdc: string;
  payTo: string;
  network: string;
}
interface SignData {
  signer: string;
  signaturePreview: string;
}
interface SettleData {
  result: Record<string, unknown>;
}

interface PaymentSteps {
  negotiate: { status: StepStatus; data?: NegotiateData };
  sign: { status: StepStatus; data?: SignData };
  settle: { status: StepStatus; data?: SettleData };
}

interface StreamEvent {
  step: "negotiate" | "sign" | "settle" | "error";
  status: StepStatus;
  data?: Record<string, unknown>;
  error?: string;
}

type PaymentState =
  | { phase: "idle" }
  | { phase: "paying"; steps: PaymentSteps }
  | { phase: "success"; steps: PaymentSteps }
  | { phase: "error"; steps: PaymentSteps; error: string };

// ---------------------------------------------------------------------------
// Step indicator component
// ---------------------------------------------------------------------------

function StepRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: StepStatus;
  detail?: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        {status === "idle" && (
          <span className="h-2 w-2 rounded-full bg-gray-600" />
        )}
        {status === "pending" && (
          <svg
            className="h-4 w-4 animate-spin text-amber-400"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
        )}
        {status === "done" && (
          <svg
            className="h-4 w-4 text-emerald-400"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
        {status === "error" && (
          <svg
            className="h-4 w-4 text-red-400"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-medium ${
            status === "idle"
              ? "text-gray-500"
              : status === "pending"
              ? "text-amber-300"
              : status === "done"
              ? "text-emerald-300"
              : "text-red-300"
          }`}
        >
          {label}
        </p>
        {detail && (
          <p className="mt-0.5 truncate font-mono text-xs text-gray-400">
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paywall modal
// ---------------------------------------------------------------------------

function PaywallModal({
  article,
  onClose,
  onSuccess,
}: {
  article: Article;
  onClose: () => void;
  onSuccess: (slug: string) => void;
}) {
  const [paymentState, setPaymentState] = useState<PaymentState>({
    phase: "idle",
  });
  const idempotencyKeyRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const shouldUnlockRef = useRef(false);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      abortRef.current?.abort();
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (paymentState.phase === "success" && shouldUnlockRef.current) {
      shouldUnlockRef.current = false;
      onSuccess(article.slug);
    }
  }, [article.slug, onSuccess, paymentState.phase]);

  const startPayment = useCallback(async () => {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }

    const steps: PaymentSteps = {
      negotiate: { status: "idle" },
      sign: { status: "idle" },
      settle: { status: "idle" },
    };

    setPaymentState({ phase: "paying", steps: { ...steps } });
    shouldUnlockRef.current = false;

    try {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const response = await fetch("/api/x402-pay", {
        method: "POST",
        headers: {
          "x-idempotency-key": idempotencyKeyRef.current,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorMessage = `Payment request failed (${response.status})`;
        try {
          const payload = (await response.json()) as { error?: string };
          if (payload.error) errorMessage = payload.error;
        } catch {
          // Keep status fallback when the response is not JSON.
        }
        throw new Error(errorMessage);
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedTerminalEvent = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (controller.signal.aborted) {
          await reader.cancel();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const chunk of lines) {
          const line = chunk.replace(/^data: /, "").trim();
          if (!line) continue;

          let event: StreamEvent;
          try {
            const parsed = JSON.parse(line) as StreamEvent;
            if (
              parsed.step !== "negotiate" &&
              parsed.step !== "sign" &&
              parsed.step !== "settle" &&
              parsed.step !== "error"
            ) {
              continue;
            }
            event = parsed;
          } catch {
            continue;
          }

          if (
            event.step === "error" ||
            (event.step === "settle" && event.status === "done")
          ) {
            receivedTerminalEvent = true;
          }

          setPaymentState((prev) => {
            if (prev.phase !== "paying" && prev.phase !== "error") return prev;
            const prevSteps = prev.steps;
            const currentPhase = prev.phase;

            if (event.step === "error") {
              return {
                phase: "error",
                steps: prevSteps,
                error: event.error ?? "Unknown error",
              };
            }

            if (event.step === "negotiate") {
              const updatedSteps: PaymentSteps = {
                ...prevSteps,
                negotiate: {
                  status: event.status,
                  data: event.data as NegotiateData | undefined,
                },
              };
              return currentPhase === "error"
                ? { ...prev, steps: updatedSteps }
                : { phase: "paying", steps: updatedSteps };
            }

            if (event.step === "sign") {
              const updatedSteps: PaymentSteps = {
                ...prevSteps,
                sign: {
                  status: event.status,
                  data: event.data as SignData | undefined,
                },
              };
              return currentPhase === "error"
                ? { ...prev, steps: updatedSteps }
                : { phase: "paying", steps: updatedSteps };
            }

            if (event.step === "settle") {
              const updatedSteps: PaymentSteps = {
                ...prevSteps,
                settle: {
                  status: event.status,
                  data: event.data as SettleData | undefined,
                },
              };

              if (event.status === "done" && currentPhase !== "error") {
                shouldUnlockRef.current = true;
                return { phase: "success", steps: updatedSteps };
              }

              // Update only the current streamed step.
              return currentPhase === "error"
                ? { ...prev, steps: updatedSteps }
                : { phase: "paying", steps: updatedSteps };
            }

            return prev;
          });
        }
      }
      if (!receivedTerminalEvent) {
        throw new Error("Payment stream ended before settlement completed");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPaymentState((prev) => ({
        phase: "error",
        steps:
          prev.phase === "paying"
            ? prev.steps
            : {
                negotiate: { status: "idle" },
                sign: { status: "idle" },
                settle: { status: "idle" },
              },
        error: message,
      }));
    }
  }, []);

  const steps =
    paymentState.phase === "paying" ||
    paymentState.phase === "success" ||
    paymentState.phase === "error"
      ? paymentState.steps
      : null;

  const negotiateDetail =
    steps?.negotiate.status === "done" && steps.negotiate.data
      ? `${steps.negotiate.data.amountUsdc} USDC → ${(
          steps.negotiate.data.payTo as string
        ).slice(0, 10)}...`
      : steps?.negotiate.status === "pending"
      ? "Contacting merchant server..."
      : undefined;

  const signDetail =
    steps?.sign.status === "done" && steps.sign.data
      ? `${(steps.sign.data.signer as string).slice(0, 10)}... signed ${
          steps.sign.data.signaturePreview
        }`
      : steps?.sign.status === "pending"
      ? "Generating EIP-3009 authorization..."
      : undefined;

  const settleDetail =
    steps?.settle.status === "done"
      ? "Transaction confirmed on-chain"
      : steps?.settle.status === "pending"
      ? "Broadcasting to Base network..."
      : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Paywall for ${article.headline}`}
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-amber-400">
              Premium
            </span>
            <span className="text-white/20">·</span>
            <span className="text-xs text-gray-400">{article.section}</span>
          </div>
          <button
            type="button"
            aria-label="Close paywall"
            onClick={onClose}
            className="text-gray-500 transition hover:text-white"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {paymentState.phase === "success" ? (
          /* ── Unlocked article ── */
          <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-900/20 px-3 py-2">
              <svg
                className="h-4 w-4 shrink-0 text-emerald-400"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-sm text-emerald-300">
                Payment confirmed — access granted
              </span>
            </div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-amber-400">
              {article.section}
            </p>
            <h2 className="mb-1 text-xl font-bold leading-snug text-white">
              {article.headline}
            </h2>
            <p className="mb-4 text-xs text-gray-500">
              {article.byline} · {article.date}
            </p>
            <div className="prose prose-sm prose-invert max-w-none">
              {article.body.split("\n\n").map((para, i) => (
                <p
                  key={i}
                  className="mb-3 text-sm leading-relaxed text-gray-300"
                >
                  {para}
                </p>
              ))}
            </div>
          </div>
        ) : (
          /* ── Paywall / payment flow ── */
          <div className="px-6 py-5">
            <h2 className="mb-1 text-lg font-bold leading-snug text-white">
              {article.headline}
            </h2>
            <p className="mb-4 text-sm leading-relaxed text-gray-400">
              {article.teaser}
            </p>

            {/* Divider with lock */}
            <div className="relative mb-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/10" />
              <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-zinc-800 px-3 py-1">
                <svg
                  className="h-3.5 w-3.5 text-amber-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-xs font-medium text-amber-400">
                  Premium content
                </span>
              </div>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            {/* Payment steps (shown once payment starts) */}
            {steps && (
              <div className="mb-5 rounded-xl border border-white/8 bg-zinc-800/60 px-4 py-1 divide-y divide-white/5">
                <StepRow
                  label="Requesting access from merchant server"
                  status={steps.negotiate.status}
                  detail={negotiateDetail}
                />
                <StepRow
                  label="Signing EIP-3009 authorization via CDP"
                  status={steps.sign.status}
                  detail={signDetail}
                />
                <StepRow
                  label="Settling payment on-chain"
                  status={steps.settle.status}
                  detail={settleDetail}
                />
              </div>
            )}

            {/* Error message */}
            {paymentState.phase === "error" && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2">
                <p className="text-xs text-red-300">{paymentState.error}</p>
              </div>
            )}

            {/* CTA */}
            <div className="flex items-center gap-4">
              {paymentState.phase === "idle" ||
              paymentState.phase === "error" ? (
                <button
                  onClick={startPayment}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-semibold text-black transition hover:bg-amber-400 active:scale-95"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
                    <path
                      fillRule="evenodd"
                      d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {paymentState.phase === "error"
                    ? "Retry Payment"
                    : "Pay $0.0001 USDC to unlock"}
                </button>
              ) : (
                <div className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-zinc-700 px-5 py-3 text-sm font-semibold text-gray-400">
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                  Processing payment...
                </div>
              )}
            </div>

            <p className="mt-3 text-center text-xs text-gray-600">
              Powered by x402 · USDC on Base · No card required
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Article card components
// ---------------------------------------------------------------------------

function FreeArticleCard({ article }: { article: Article }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="group border-b border-white/8 pb-5">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-500">
        {article.section}
      </p>
      <h2 className="mb-1 text-lg font-bold leading-snug text-white transition group-hover:text-amber-100">
        {article.headline}
      </h2>
      <p className="mb-2 text-xs text-gray-500">
        {article.byline} · {article.date}
      </p>
      <p className="text-sm leading-relaxed text-gray-400">{article.teaser}</p>
      {expanded && (
        <div className="mt-3 border-t border-white/5 pt-3">
          {article.body.split("\n\n").map((para, i) => (
            <p key={i} className="mb-3 text-sm leading-relaxed text-gray-300">
              {para}
            </p>
          ))}
        </div>
      )}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 text-xs font-medium text-amber-500 transition hover:text-amber-300"
      >
        {expanded ? "Show less" : "Continue reading →"}
      </button>
    </article>
  );
}

function PremiumArticleCard({
  article,
  onUnlock,
  unlocked,
}: {
  article: Article;
  onUnlock: () => void;
  unlocked: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (unlocked) {
    return (
      <article className="group border-b border-white/8 pb-5">
        <div className="mb-1 flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-500">
            {article.section}
          </p>
          <span className="rounded-full bg-emerald-900/40 px-2 py-0.5 text-xs font-medium text-emerald-400">
            Subscribed
          </span>
        </div>
        <h2 className="mb-1 text-lg font-bold leading-snug text-white">
          {article.headline}
        </h2>
        <p className="mb-2 text-xs text-gray-500">
          {article.byline} · {article.date}
        </p>
        <p className="text-sm leading-relaxed text-gray-400">
          {article.teaser}
        </p>
        {expanded && (
          <div className="mt-3 border-t border-white/5 pt-3">
            {article.body.split("\n\n").map((para, i) => (
              <p key={i} className="mb-3 text-sm leading-relaxed text-gray-300">
                {para}
              </p>
            ))}
          </div>
        )}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-medium text-amber-500 transition hover:text-amber-300"
        >
          {expanded ? "Show less" : "Continue reading →"}
        </button>
      </article>
    );
  }

  return (
    <article className="group relative border-b border-white/8 pb-5">
      <div className="mb-1 flex items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-500">
          {article.section}
        </p>
        <span className="rounded-full bg-amber-900/30 px-2 py-0.5 text-xs font-medium text-amber-400">
          Premium
        </span>
      </div>
      <h2 className="mb-1 text-lg font-bold leading-snug text-white">
        {article.headline}
      </h2>
      <p className="mb-2 text-xs text-gray-500">
        {article.byline} · {article.date}
      </p>
      {/* Teaser with gradient fade */}
      <div className="relative overflow-hidden">
        <p className="text-sm leading-relaxed text-gray-400">
          {article.teaser}
        </p>
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-zinc-950/90 to-transparent" />
      </div>
      <button
        onClick={onUnlock}
        className="mt-3 flex items-center gap-1.5 text-xs font-medium text-amber-400 transition hover:text-amber-300"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
            clipRule="evenodd"
          />
        </svg>
        Unlock with USDC →
      </button>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Main newspaper page
// ---------------------------------------------------------------------------

export default function NewspaperPage() {
  const [activeArticle, setActiveArticle] = useState<Article | null>(null);
  const [unlockedSlugs, setUnlockedSlugs] = useState<Set<string>>(new Set());

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const freeArticles = ARTICLES.filter((a) => !a.premium);
  const premiumArticles = ARTICLES.filter((a) => a.premium);
  const featuredFree = freeArticles.find((a) => a.col === "wide");
  const sideFreeArticles = freeArticles.filter((a) => a.col !== "wide");
  const featuredPremium = premiumArticles.find((a) => a.col === "wide");
  const sidePremiumArticles = premiumArticles.filter((a) => a.col !== "wide");

  function handleUnlock(article: Article) {
    setActiveArticle(article);
  }

  function handlePaymentSuccess(slug: string) {
    setUnlockedSlugs((prev) => new Set([...prev, slug]));
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Masthead */}
      <header className="border-b border-white/10 bg-zinc-900 px-6 py-4">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-4xl font-black tracking-tight text-white">
                The Sangria Gazette
              </h1>
              <p className="mt-0.5 text-xs text-gray-500">
                Established 2026 · Independent Digital News
              </p>
            </div>
            <div className="hidden text-right md:block">
              <p className="text-xs text-gray-500">{today}</p>
              <p className="mt-0.5 text-xs text-gray-600">Vol. 1, No. 1</p>
            </div>
          </div>
          {/* Nav */}
          <nav className="mt-3 flex gap-4 border-t border-white/8 pt-3">
            {["Economy", "Technology", "World", "Finance", "Science"].map(
              (s) => (
                <span
                  key={s}
                  className="cursor-default text-xs font-medium text-gray-400 transition hover:text-white"
                >
                  {s}
                </span>
              )
            )}
          </nav>
        </div>
      </header>

      {/* Body */}
      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Breaking banner */}
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-950/20 px-4 py-2.5">
          <span className="rounded bg-amber-500 px-1.5 py-0.5 text-xs font-black uppercase tracking-wider text-black">
            Breaking
          </span>
          <p className="text-sm text-gray-300">
            Stablecoin payments cross{" "}
            <span className="font-semibold text-white">$10 trillion</span> in
            annual volume — x402 protocol sees explosive adoption
          </p>
        </div>

        {/* Free articles section */}
        <section className="mb-10">
          <h2 className="mb-4 border-b border-white/10 pb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">
            Top Stories — Free Access
          </h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {featuredFree && (
              <div className="md:col-span-2">
                <FreeArticleCard article={featuredFree} />
              </div>
            )}
            <div className="space-y-6">
              {sideFreeArticles.map((a) => (
                <FreeArticleCard key={a.slug} article={a} />
              ))}
            </div>
          </div>
        </section>

        {/* Premium divider */}
        <div className="relative mb-8 flex items-center gap-4">
          <div className="h-px flex-1 bg-amber-500/20" />
          <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-950/30 px-4 py-1.5">
            <svg
              className="h-3.5 w-3.5 text-amber-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              Premium Reporting
            </span>
          </div>
          <div className="h-px flex-1 bg-amber-500/20" />
        </div>

        {/* Premium articles section */}
        <section>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {featuredPremium && (
              <div className="md:col-span-2">
                <PremiumArticleCard
                  article={featuredPremium}
                  onUnlock={() => handleUnlock(featuredPremium)}
                  unlocked={unlockedSlugs.has(featuredPremium.slug)}
                />
              </div>
            )}
            <div className="space-y-6">
              {sidePremiumArticles.map((a) => (
                <PremiumArticleCard
                  key={a.slug}
                  article={a}
                  onUnlock={() => handleUnlock(a)}
                  unlocked={unlockedSlugs.has(a.slug)}
                />
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-12 border-t border-white/8 pt-6 text-center">
          <p className="text-xs text-gray-600">
            Premium articles are unlocked via{" "}
            <span className="font-mono text-amber-600">x402</span> micropayments
            · USDC on Base · Powered by Sangria
          </p>
        </footer>
      </main>

      {/* Paywall modal */}
      {activeArticle && (
        <PaywallModal
          key={activeArticle.slug}
          article={activeArticle}
          onClose={() => setActiveArticle(null)}
          onSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  );
}
