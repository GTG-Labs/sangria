import { z } from "zod";
import validator from "validator";
import disposableEmailDomains from "disposable-email-domains";
import { getDomain } from "tldts";
import { SecurityUtils, securityValidations } from "./security";

// Extract registrable domain from a full domain using Public Suffix List
function getRegistrableDomain(domain: string): string {
  const registrableDomain = getDomain(domain);
  return registrableDomain ?? domain;
}

// Email validation helper using maintained disposable domain list
function isDisposableEmail(email: string): boolean {
  try {
    const fullDomain = email.split('@')[1]?.toLowerCase();
    if (!fullDomain) return false;

    // Get the registrable domain to check against the list
    const registrableDomain = getRegistrableDomain(fullDomain);

    // Check exact match against the curated disposable domains list
    const isInList = disposableEmailDomains.includes(fullDomain) ||
      disposableEmailDomains.includes(registrableDomain);

    if (isInList) return true;

    // Additional heuristic checks with anchored patterns (only for edge cases)
    const suspiciousPatterns = [
      /^temp(mail|email|box)/, // Starts with tempmail, tempemail, tempbox
      /^throw(away|mail)/, // Starts with throwaway, throwmail
      /^fake(mail|email|box)/, // Starts with fakemail, fakeemail, fakebox
      /^guerrilla(mail|email)/, // Starts with guerrillamail, guerrillaemail
      /^(\d+)min(ute)?mail/, // Starts with digits + min/minute + mail (10minutemail)
      /^(trash|spam|junk)mail/, // Starts with trash/spam/junk + mail
    ];

    return suspiciousPatterns.some(pattern => pattern.test(registrableDomain));
  } catch {
    return false;
  }
}

// Enhanced email validation using validator.js
const emailSchema = z
  .string()
  .min(1, "Email is required")
  .max(254, "Email is too long")
  .refine((email) => {
    // Use validator.js for robust email validation
    return validator.isEmail(email, {
      domain_specific_validation: true,
      allow_display_name: false,
      require_display_name: false,
      allow_utf8_local_part: true,
      require_tld: true,
    });
  }, "Please enter a valid business email address")
  .refine((email) => {
    // Check for disposable email patterns
    return !isDisposableEmail(email);
  }, "Temporary email addresses are not allowed")
  .refine((email) => {
    // Require proper business domain structure
    const domain = email.split('@')[1];
    if (!domain) return false;

    // Must have at least one dot and proper TLD
    const parts = domain.split('.');
    if (parts.length < 2) return false;

    const tld = parts[parts.length - 1];
    // Allow ASCII letters plus digits/hyphen to support punycode IDN TLDs (xn--…)
    return !!tld && tld.length >= 2 && /^[a-zA-Z]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(tld);
  }, "Please enter a valid business email address");

// Base name schema for reusable validation patterns
const createNameSchema = (maxLength: number) => z
  .string()
  .min(1, "Name is required")
  .min(2, "Name must be at least 2 characters")
  .max(maxLength, "Name is too long")
  .refine((val) => {
    // Use Unicode-aware validation instead of restrictive ASCII regex
    return SecurityUtils.containsOnlySafeChars(val, 'name');
  }, "Name contains invalid characters")
  .refine((val) => securityValidations.noXSS(val) === true, "Input contains potentially dangerous content")
  .refine((val) => securityValidations.safeUnicode(val) === true, "Suspicious character combinations detected")
  .superRefine((val, ctx) => {
    // Single call to sanitizeInput to check warnings
    const result = SecurityUtils.sanitizeInput(val, { type: 'name', maxLength });

    // Fail validation if any warnings exist (no silent mutations)
    if (result.warnings.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `Input contains characters that cannot be safely processed: ${result.warnings.join(', ')}`,
      });
    }

    // No return value needed - superRefine only validates
    // The input passes through unchanged if no issues are added
  });

// Organization creation validation
export const organizationSchema = z.object({
  name: createNameSchema(100)
    .refine((name) => name.trim().length === name.length, "Organization name cannot start or end with spaces"),
});

// Organization member invitation validation
export const inviteSchema = z.object({
  email: emailSchema,
  message: z
    .string()
    .max(500, "Message is too long")
    .refine((val) => !val || SecurityUtils.containsOnlySafeChars(val, 'general'), "Message contains invalid characters")
    .refine((val) => !val || securityValidations.noXSS(val) === true, "Message contains potentially dangerous content")
    .refine((val) => !val || securityValidations.safeUnicode(val) === true, "Suspicious characters detected in message")
    .superRefine((val, ctx) => {
      if (!val) return; // Empty values are allowed

      // Single call to sanitizeInput to check warnings
      const result = SecurityUtils.sanitizeInput(val, { type: 'general', maxLength: 500 });

      // Fail validation if any warnings exist (no silent mutations)
      if (result.warnings.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: `Message contains characters that cannot be safely processed: ${result.warnings.join(', ')}`,
        });
      }

      // No return value needed - superRefine only validates
      // The input passes through unchanged if no issues are added
    })
    .optional(),
});

// API Key creation validation
export const apiKeySchema = z.object({
  name: createNameSchema(255),
});

// Safe currency validation - blocks scientific notation, infinity, etc.
const safeCurrencyRegex = /^\d{1,8}(\.\d{1,2})?$/;

// Withdrawal validation with bulletproof financial security
export const withdrawalSchema = z.object({
  amount: z
    .string()
    .min(1, "Amount is required")
    .refine((val) => {
      // Block scientific notation, infinity, NaN, etc.
      return safeCurrencyRegex.test(val.trim());
    }, "Enter amount like 123.45 (numbers only, max 2 decimal places)")
    .refine((val) => {
      // Safe parsing after regex validation
      const num = Number(val);
      return num > 0;
    }, "Amount must be greater than 0")
    .refine((val) => {
      // Maximum withdrawal limit ($100,000)
      const num = Number(val);
      return num <= 100000;
    }, "Maximum withdrawal amount is $100,000")
    .refine((val) => {
      // Minimum withdrawal ($0.01)
      const num = Number(val);
      return num >= 0.01;
    }, "Minimum withdrawal amount is $0.01"),
});

// Custom withdrawal validation with balance check
export const createWithdrawalSchema = (balance: number | null) => {
  return withdrawalSchema.extend({
    amount: withdrawalSchema.shape.amount.refine((val) => {
      if (balance === null) return true; // Skip balance check if not available
      // Safe conversion - already validated by regex
      const microunits = Math.round(Number(val) * 1_000_000);
      return microunits <= balance;
    }, "Amount exceeds available balance"),
  });
};

// Generic text input validation with comprehensive security
export const textInputSchema = z.object({
  value: z
    .string()
    .max(1000, "Input is too long")
    .refine((val) => val.trim().length > 0, "Input cannot be empty")
    .refine((val) => SecurityUtils.containsOnlySafeChars(val, 'general'), "Input contains invalid characters")
    .refine((val) => securityValidations.noXSS(val) === true, "Input contains potentially dangerous content")
    .refine((val) => securityValidations.safeUnicode(val) === true, "Suspicious character combinations detected")
    .superRefine((val, ctx) => {
      // Single call to sanitizeInput to check warnings
      const result = SecurityUtils.sanitizeInput(val, { type: 'general', maxLength: 1000 });

      // Fail validation if any warnings exist (no silent mutations)
      if (result.warnings.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: `Input contains characters that cannot be safely processed: ${result.warnings.join(', ')}`,
        });
      }

      // No return value needed - superRefine only validates
      // The input passes through unchanged if no issues are added
    }),
});

// Token validation (for invitations, etc.)
export const tokenSchema = z.object({
  token: z
    .string()
    .min(1, "Token is required")
    .max(500, "Invalid token format")
    .refine((token) => token.trim() === token, "Invalid token format")
    .refine(
      (token) => /^[0-9a-f]{64}$/.test(token),
      "Invalid token format"
    ),
});

// Helper function to safely parse and validate
export function safeValidate<T>(schema: z.ZodSchema<T>, data: unknown) {
  const result = schema.safeParse(data);

  if (result.success) {
    return {
      success: true as const,
      data: result.data,
      error: null,
    };
  } else {
    return {
      success: false as const,
      data: null,
      error: result.error?.issues[0]?.message || "Validation failed",
    };
  }
}

// Type exports for TypeScript integration
export type OrganizationData = z.infer<typeof organizationSchema>;
export type InviteData = z.infer<typeof inviteSchema>;
export type APIKeyData = z.infer<typeof apiKeySchema>;
export type WithdrawalData = z.infer<typeof withdrawalSchema>;
export type TextInputData = z.infer<typeof textInputSchema>;
export type TokenData = z.infer<typeof tokenSchema>;