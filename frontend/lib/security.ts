import DOMPurify from "dompurify";

// XSS Protection and HTML Sanitization
export class SecurityUtils {
  // Sanitize HTML content to prevent XSS attacks
  static sanitizeHtml(input: string): string {
    if (typeof window === "undefined") {
      // Server-side: basic HTML escaping
      return input
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    // Client-side: use DOMPurify for comprehensive sanitization
    return DOMPurify.sanitize(input, {
      ALLOWED_TAGS: [], // No HTML tags allowed
      ALLOWED_ATTR: [], // No attributes allowed
      KEEP_CONTENT: true, // Keep text content
    });
  }

  // Sanitize text input to prevent script injection
  static sanitizeText(input: string): string {
    return input
      .replace(/[<>]/g, "") // Remove angle brackets
      .replace(/javascript:/gi, "") // Remove javascript protocols
      .replace(/on\w+\s*=/gi, "") // Remove event handlers
      .replace(/data:/gi, "") // Remove data URLs
      .trim();
  }

  // Normalize Unicode to prevent homograph attacks
  static normalizeUnicode(input: string): string {
    return input
      .normalize("NFKC") // Canonical decomposition + canonical composition
      .replace(/[\u200B-\u200D\uFEFF]/g, "") // Remove zero-width characters
      .replace(/[\u2000-\u206F]/g, " ") // Replace various Unicode spaces with regular space
      .replace(/[\uFFF9-\uFFFB]/g, "") // Remove interlinear annotation characters
      .trim();
  }

  // Check for suspicious Unicode patterns (homograph attacks and dangerous codepoints)
  static containsSuspiciousUnicode(input: string): boolean {
    // Check for dangerous control/invisible characters
    const dangerousCodepoints = [
      /[\u202A-\u202E]/, // Bidirectional text override characters
      /[\u200B-\u200D]/, // Zero-width characters (except normal spaces)
      /[\u2066-\u2069]/, // Directional isolate characters
      /[\uFFF9-\uFFFB]/, // Interlinear annotation characters
      /[\u180E]/, // Mongolian vowel separator
      /[\u061C]/, // Arabic letter mark
      /[\u2028-\u2029]/, // Line/paragraph separators
      /[\u{E0000}-\u{E007F}]/u, // Tag characters
    ];

    // Check for dangerous invisible/control characters
    for (const pattern of dangerousCodepoints) {
      if (pattern.test(input)) {
        return true;
      }
    }

    // Check for non-Latin script mixing (excluding common Latin)
    // Only flag mixing of non-Latin scripts or suspicious combinations
    const cyrillicRegex = /[\u0400-\u04FF]/;
    const greekRegex = /[\u0370-\u03FF]/;
    const arabicRegex = /[\u0600-\u06FF]/;
    const cjkRegex = /[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF]/;
    const hebrewRegex = /[\u0590-\u05FF]/;

    const nonLatinScripts = [
      cyrillicRegex.test(input),
      greekRegex.test(input),
      arabicRegex.test(input),
      cjkRegex.test(input),
      hebrewRegex.test(input),
    ];

    // Flag if multiple non-Latin scripts are mixed (potential homograph attack)
    const nonLatinScriptCount = nonLatinScripts.filter(Boolean).length;
    return nonLatinScriptCount > 1;
  }

  // Validate safe character sets for different input types
  static containsOnlySafeChars(
    input: string,
    type: "name" | "email" | "currency" | "general",
  ): boolean {
    // First check for dangerous control/invisible characters
    const dangerousControlChars =
      /[\u202A-\u202E\u200B-\u200D\u2066-\u2069\uFFF9-\uFFFB\u180E\u061C\u2028-\u2029\u{E0000}-\u{E007F}]/u;
    if (dangerousControlChars.test(input)) {
      return false;
    }

    const patterns = {
      // Allow Unicode letters/marks/numbers plus a narrow set of punctuation
      name: /^[\p{L}\p{M}\p{N}\s\-_.&()'']+$/u,
      email:
        /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
      currency: /^\d{1,8}(\.\d{1,2})?$/,
      general: /^[\p{L}\p{M}\p{N}\s\-_.!?,:;()&@#'']+$/u,
    };

    return patterns[type].test(input);
  }

  // Comprehensive input sanitization
  static sanitizeInput(
    input: string,
    options: {
      maxLength?: number;
      type?: "name" | "email" | "currency" | "general";
      allowUnicode?: boolean;
    } = {},
  ): { sanitized: string; warnings: string[] } {
    const warnings: string[] = [];
    let sanitized = input;

    // Length check
    if (options.maxLength && sanitized.length > options.maxLength) {
      sanitized = sanitized.substring(0, options.maxLength);
      warnings.push(`Input truncated to ${options.maxLength} characters`);
    }

    // Unicode normalization and checks
    if (!options.allowUnicode) {
      if (this.containsSuspiciousUnicode(sanitized)) {
        warnings.push("Suspicious character mixing detected");
      }
      sanitized = this.normalizeUnicode(sanitized);
    }

    // Character set validation
    if (options.type && !this.containsOnlySafeChars(sanitized, options.type)) {
      warnings.push(`Invalid characters for ${options.type} input`);

      // Only auto-sanitize for specific types, not for names (to prevent silent mutation)
      if (options.type === "currency") {
        sanitized = sanitized.replace(/[^0-9.]/g, "");
      }
      // For 'name' and 'general' types, don't auto-sanitize to avoid silent data corruption
      // Validation schemas should check warnings and fail appropriately
    }

    // HTML/XSS sanitization
    sanitized = this.sanitizeHtml(sanitized);

    return { sanitized, warnings };
  }

  // Secure display of user content
  static secureDisplay(input: string): string {
    const { sanitized } = this.sanitizeInput(input, {
      type: "general",
      allowUnicode: false,
      maxLength: 1000,
    });
    return sanitized;
  }
}

// JSON Serialization Security
export class JSONSecurity {
  // Maximum recursion depth to prevent stack overflow
  private static readonly MAX_DEPTH = 10;

  // Safe JSON serialization with prototype pollution and cycle protection
  static safeStringify(obj: unknown): string {
    if (obj === null || obj === undefined) {
      return "null";
    }

    // Prevent prototype pollution attacks with cycle detection and depth limiting
    if (typeof obj === "object" && obj !== null) {
      const visited = new WeakSet<object>();
      const safeObj = this.sanitizeObject(obj, visited, 0);
      return JSON.stringify(safeObj);
    }

    // For primitive types, use normal JSON.stringify
    return JSON.stringify(obj);
  }

  // Deep sanitization to prevent prototype pollution with cycle and depth protection
  private static sanitizeObject(obj: unknown, visited: WeakSet<object>, depth: number): unknown {
    if (obj === null || obj === undefined) {
      return obj;
    }

    // Prevent excessive recursion depth
    if (depth > this.MAX_DEPTH) {
      return "[MaxDepth]";
    }

    if (typeof obj === "object") {
      // Detect and break circular references
      if (visited.has(obj as object)) {
        return "[Circular]";
      }

      // Mark object as visited
      visited.add(obj as object);

      if (Array.isArray(obj)) {
        // Arrays also increment depth to count nested empty arrays properly
        return obj.map((item) => this.sanitizeObject(item, visited, depth + 1));
      }

      const sanitized: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        // Block dangerous property names
        if (this.isDangerousKey(key)) {
          continue; // Skip dangerous keys
        }

        // Recursively sanitize nested objects with incremented depth
        sanitized[key] = this.sanitizeObject(value, visited, depth + 1);
      }

      return sanitized;
    }

    return obj;
  }

  // Check for dangerous object keys that could lead to prototype pollution
  private static isDangerousKey(key: string): boolean {
    const dangerousKeys = [
      "__proto__",
      "constructor",
      "prototype",
      "__defineGetter__",
      "__defineSetter__",
      "__lookupGetter__",
      "__lookupSetter__",
    ];

    return dangerousKeys.includes(key);
  }

  // Check for circular references using WeakSet-based detection
  private static hasCycles(obj: unknown, visited = new WeakSet<object>()): boolean {
    if (obj === null || obj === undefined || typeof obj !== "object") {
      return false;
    }

    // Detect circular reference
    if (visited.has(obj as object)) {
      return true;
    }

    // Mark object as visited
    visited.add(obj as object);

    try {
      if (Array.isArray(obj)) {
        for (const item of obj) {
          if (this.hasCycles(item, visited)) {
            return true;
          }
        }
      } else {
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            if (this.hasCycles((obj as Record<string, unknown>)[key], visited)) {
              return true;
            }
          }
        }
      }
    } finally {
      // Remove from visited set for other traversal paths
      visited.delete(obj as object);
    }

    return false;
  }

  // Validate object structure before serialization
  static validateObjectStructure(obj: unknown): { isValid: boolean; error?: string } {
    // Check for circular references first
    if (this.hasCycles(obj)) {
      return { isValid: false, error: "Circular reference detected" };
    }

    // Check depth (prevent deeply nested objects)
    if (this.getObjectDepth(obj) > 10) {
      return { isValid: false, error: "Object nesting too deep" };
    }

    // Check for dangerous keys
    if (this.containsDangerousKeys(obj)) {
      return { isValid: false, error: "Object contains dangerous properties" };
    }

    return { isValid: true };
  }

  // Calculate object nesting depth with cycle protection
  private static getObjectDepth(obj: unknown, visited = new WeakSet<object>(), depth = 0): number {
    if (depth > this.MAX_DEPTH) return depth; // Prevent stack overflow

    if (obj === null || obj === undefined || typeof obj !== "object") {
      return depth;
    }

    // Detect and break circular references
    if (visited.has(obj as object)) {
      return depth; // Return current depth for circular reference
    }

    // Mark object as visited
    visited.add(obj as object);

    if (Array.isArray(obj)) {
      if (obj.length === 0) return depth + 1; // Empty arrays still increment depth
      return Math.max(...obj.map((item) => this.getObjectDepth(item, visited, depth + 1)));
    }

    const values = Object.values(obj as Record<string, unknown>);
    if (values.length === 0) return depth + 1; // Empty objects still increment depth

    return Math.max(...values.map((value) => this.getObjectDepth(value, visited, depth + 1)));
  }

  // Check if object contains dangerous keys with cycle protection
  private static containsDangerousKeys(obj: unknown, visited = new WeakSet<object>()): boolean {
    if (obj === null || obj === undefined || typeof obj !== "object") {
      return false;
    }

    // Detect and break circular references
    if (visited.has(obj as object)) {
      return false; // Assume no dangerous keys in circular reference
    }

    // Mark object as visited
    visited.add(obj as object);

    if (Array.isArray(obj)) {
      return obj.some((item) => this.containsDangerousKeys(item, visited));
    }

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (this.isDangerousKey(key)) {
        return true;
      }
      if (this.containsDangerousKeys(value, visited)) {
        return true;
      }
    }

    return false;
  }
}

// Validation helpers for forms
export const securityValidations = {
  noXSS: (value: string) => {
    const original = value;
    const sanitized = SecurityUtils.sanitizeHtml(value);
    return original === sanitized || "Input contains potentially dangerous content";
  },

  safeUnicode: (value: string) => {
    return (
      !SecurityUtils.containsSuspiciousUnicode(value) ||
      "Suspicious character combinations detected"
    );
  },

  safeCharacters: (value: string, type: "name" | "email" | "currency" | "general") => {
    return (
      SecurityUtils.containsOnlySafeChars(value, type) || `Invalid characters for ${type} input`
    );
  },
};
