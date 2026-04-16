import { Injectable, BadRequestException } from '@nestjs/common';
import { TransformType } from '@mycase-hubspot/shared-types';

/**
 * Applies a single field transform in either direction.
 *
 * Direction conventions:
 *   'hs_to_mc' → value comes from HubSpot, needs to be shaped for MyCase
 *   'mc_to_hs' → value comes from MyCase, needs to be shaped for HubSpot
 */
@Injectable()
export class FieldTransformerService {
  transform(
    value: unknown,
    transformType: TransformType,
    transformConfig: Record<string, unknown> | null,
    direction: 'hs_to_mc' | 'mc_to_hs',
  ): unknown {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }

    switch (transformType) {
      case 'direct':
        return this.direct(value);

      case 'date_format':
        return this.dateFormat(value, direction);

      case 'currency_cents':
        return this.currencyCents(value, direction);

      case 'boolean_string':
        return this.booleanString(value, direction);

      case 'select_remap':
        return this.selectRemap(
          value,
          (transformConfig?.map ?? {}) as Record<string, string>,
          direction,
        );

      case 'phone_format':
        return this.phoneFormat(value);

      case 'truncate':
        return this.truncate(
          value,
          (transformConfig?.maxLength as number) ?? 65_536,
        );

      case 'html_strip':
        return this.htmlStrip(value);

      default:
        return value;
    }
  }

  // ── Transform implementations ────────────────────────────────────────────────

  private direct(value: unknown): unknown {
    return String(value);
  }

  /**
   * HubSpot stores dates as epoch milliseconds (string).
   * MyCase uses ISO date strings (YYYY-MM-DD).
   */
  private dateFormat(value: unknown, direction: 'hs_to_mc' | 'mc_to_hs'): string | undefined {
    const str = String(value).trim();
    if (!str) return undefined;

    if (direction === 'hs_to_mc') {
      // HubSpot epoch ms → ISO date
      const ms = Number(str);
      if (isNaN(ms)) {
        // Already an ISO string?
        const d = new Date(str);
        return isNaN(d.getTime()) ? undefined : d.toISOString().split('T')[0];
      }
      return new Date(ms).toISOString().split('T')[0];
    } else {
      // MyCase ISO date → HubSpot epoch ms string
      const d = new Date(str);
      return isNaN(d.getTime()) ? undefined : String(d.getTime());
    }
  }

  /**
   * HubSpot stores dollar amounts as decimal strings (e.g. "1500.00").
   * MyCase stores rates as cents (integer) or may use decimals.
   */
  private currencyCents(value: unknown, direction: 'hs_to_mc' | 'mc_to_hs'): unknown {
    if (direction === 'hs_to_mc') {
      // "1500.00" → 150000 (cents)
      const dollars = parseFloat(String(value));
      return isNaN(dollars) ? undefined : Math.round(dollars * 100);
    } else {
      // 150000 (cents) → "1500.00"
      const cents = Number(value);
      return isNaN(cents) ? undefined : (cents / 100).toFixed(2);
    }
  }

  /**
   * HubSpot uses "true"/"false" strings for boolean properties.
   * MyCase uses actual booleans.
   */
  private booleanString(value: unknown, direction: 'hs_to_mc' | 'mc_to_hs'): unknown {
    if (direction === 'hs_to_mc') {
      // "true" → true
      if (value === 'true' || value === true) return true;
      if (value === 'false' || value === false) return false;
      return undefined;
    } else {
      // true → "true"
      if (value === true || value === 'true') return 'true';
      if (value === false || value === 'false') return 'false';
      return undefined;
    }
  }

  /**
   * Remaps enum values using a user-configured map.
   * If direction is 'mc_to_hs', the map is inverted.
   */
  private selectRemap(
    value: unknown,
    map: Record<string, string>,
    direction: 'hs_to_mc' | 'mc_to_hs',
  ): string | undefined {
    const str = String(value);
    if (direction === 'hs_to_mc') {
      return map[str] ?? str;
    } else {
      // Invert the map
      const inverted = Object.fromEntries(
        Object.entries(map).map(([k, v]) => [v, k]),
      );
      return inverted[str] ?? str;
    }
  }

  /**
   * Normalises phone numbers to E.164 format (+1XXXXXXXXXX for US).
   * Strips everything except digits and leading +.
   */
  private phoneFormat(value: unknown): string | undefined {
    const str = String(value).trim();
    const digits = str.replace(/\D/g, '');
    if (!digits) return undefined;

    if (digits.length === 10) {
      return `+1${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    // International — return as +digits
    return str.startsWith('+') ? `+${digits}` : str;
  }

  /** Truncates string to maxLength characters */
  private truncate(value: unknown, maxLength: number): string {
    return String(value).slice(0, maxLength);
  }

  /** Strips HTML tags and decodes common HTML entities */
  private htmlStrip(value: unknown): string {
    return String(value)
      .replace(/<[^>]*>/g, '')       // strip tags
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s{2,}/g, ' ')       // collapse whitespace
      .trim();
  }

  // ── Path helpers (for nested fields like phone_numbers[0].number) ──────────

  getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  setNestedValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void {
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const next = parts[i + 1];
      const isNextIndex = /^\d+$/.test(next);

      if (current[part] == null) {
        current[part] = isNextIndex ? [] : {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }
}
