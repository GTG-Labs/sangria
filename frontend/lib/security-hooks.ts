import { useState, useEffect, useRef, useCallback } from "react";

// Rate limiting hook for form submissions
export function useRateLimit(maxAttempts: number = 5, windowMs: number = 60000) {
  const attemptsRef = useRef<number[]>([]);
  const cooldownEndRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const checkRateLimit = useCallback(() => {
    const now = Date.now();
    const windowStart = now - windowMs;

    // Remove old attempts outside the window
    attemptsRef.current = attemptsRef.current.filter((attempt) => attempt > windowStart);

    // Check if we're still in cooldown using ref for current value
    const currentCooldownEnd = cooldownEndRef.current;
    if (currentCooldownEnd && now < currentCooldownEnd) {
      return { ok: false, retryAfterMs: currentCooldownEnd - now };
    }

    // Check if we've exceeded the rate limit
    if (attemptsRef.current.length >= maxAttempts) {
      const cooldownDuration = 30000; // 30 second cooldown
      const newCooldownEnd = now + cooldownDuration;

      cooldownEndRef.current = newCooldownEnd;
      setIsBlocked(true);

      // Clear existing timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      // Auto-unblock after cooldown with cleanup tracking
      timerRef.current = setTimeout(() => {
        cooldownEndRef.current = null;
        setIsBlocked(false);
        timerRef.current = null;
      }, cooldownDuration);

      return { ok: false, retryAfterMs: cooldownDuration };
    }

    // Record this attempt
    attemptsRef.current.push(now);
    return { ok: true, retryAfterMs: 0 };
  }, [maxAttempts, windowMs]);

  const getRemainingCooldown = useCallback(() => {
    const currentCooldownEnd = cooldownEndRef.current;
    if (!currentCooldownEnd) return 0;
    return Math.max(0, currentCooldownEnd - Date.now());
  }, []);

  const getAttemptsRemaining = useCallback(() => {
    return Math.max(0, maxAttempts - attemptsRef.current.length);
  }, [maxAttempts]);

  return {
    canProceed: checkRateLimit,
    isBlocked,
    remainingCooldown: getRemainingCooldown,
    attemptsRemaining: getAttemptsRemaining,
  };
}

// Enhanced form submission hook with security features
export function useSecureSubmit<T>(
  onSubmit: (data: T) => Promise<void>,
  options: {
    maxAttempts?: number;
    rateLimitWindow?: number;
  } = {},
) {
  const { maxAttempts = 5, rateLimitWindow = 60000 } = options;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const rateLimit = useRateLimit(maxAttempts, rateLimitWindow);

  // Stable references for memoization optimization
  const canProceed = rateLimit.canProceed;
  const getRemainingCooldown = rateLimit.remainingCooldown;
  const getAttemptsRemaining = rateLimit.attemptsRemaining;

  const secureSubmit = useCallback(
    async (data: T) => {
      // Check rate limiting with correct return format
      const rateLimitResult = canProceed();
      if (!rateLimitResult.ok) {
        throw new Error(
          `Too many attempts. Please wait ${Math.ceil(rateLimitResult.retryAfterMs / 1000)} seconds.`,
        );
      }

      // Prevent duplicate submissions using ref to avoid stale closure
      if (isSubmittingRef.current) {
        throw new Error("Submission already in progress");
      }

      isSubmittingRef.current = true;
      setIsSubmitting(true);

      try {
        // Direct submission - no double invocation
        await onSubmit(data);
      } catch (error) {
        console.error("Submission error:", error);
        throw error;
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [onSubmit, canProceed, getRemainingCooldown],
  );

  return {
    secureSubmit,
    isSubmitting,
    isBlocked: rateLimit.isBlocked,
    attemptsRemaining: getAttemptsRemaining,
    remainingCooldown: getRemainingCooldown,
  };
}
