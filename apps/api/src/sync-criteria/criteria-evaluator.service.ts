import { Injectable } from '@nestjs/common';
import { SyncFilterGroup } from '@mycase-hubspot/db';

export interface CriteriaRule {
  id: string;
  ruleName: string | null;
  filterGroups: SyncFilterGroup[];
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function parseHsDate(val: string): number | null {
  const asNum = Number(val);
  // HubSpot stores dates as epoch ms (13-digit) or epoch seconds (10-digit)
  if (!isNaN(asNum) && asNum > 0) {
    return asNum > 1e10 ? asNum : asNum * 1000;
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function endOfDay(ts: number): number {
  return startOfDay(ts) + 86_400_000 - 1;
}

function resolveDatePreset(preset: string): { start: number; end: number } | null {
  const now = new Date();
  const tod = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;

  switch (preset) {
    case 'today':     return { start: tod, end: tod + day - 1 };
    case 'yesterday': return { start: tod - day, end: tod - 1 };
    case 'tomorrow':  return { start: tod + day, end: tod + 2 * day - 1 };
    case 'this_week': {
      const dow = now.getDay();
      const s = tod - dow * day;
      return { start: s, end: s + 7 * day - 1 };
    }
    case 'last_week': {
      const dow = now.getDay();
      const s = tod - (dow + 7) * day;
      return { start: s, end: s + 7 * day - 1 };
    }
    case 'this_month': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime() + day - 1;
      return { start: s, end: e };
    }
    case 'last_month': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
      const e = new Date(now.getFullYear(), now.getMonth(), 0).getTime() + day - 1;
      return { start: s, end: e };
    }
    case 'this_quarter': {
      const q = Math.floor(now.getMonth() / 3);
      const s = new Date(now.getFullYear(), q * 3, 1).getTime();
      const e = new Date(now.getFullYear(), q * 3 + 3, 0).getTime() + day - 1;
      return { start: s, end: e };
    }
    case 'last_quarter': {
      const q = Math.floor(now.getMonth() / 3);
      const pq = q === 0 ? 3 : q - 1;
      const yr = q === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const s = new Date(yr, pq * 3, 1).getTime();
      const e = new Date(yr, pq * 3 + 3, 0).getTime() + day - 1;
      return { start: s, end: e };
    }
    case 'this_fiscal_quarter':
    case 'last_fiscal_quarter': {
      // Fiscal year starts Feb 1 (HubSpot default)
      const m = now.getMonth();
      // Fiscal months: Feb=0,Mar=1,Apr=2 → FQ1; May=3,Jun=4,Jul=5 → FQ2; Aug=6,Sep=7,Oct=8 → FQ3; Nov=9,Dec=10,Jan=11 → FQ4
      const fm = m === 0 ? 11 : m - 1; // shift month so Feb = 0
      const fq = Math.floor(fm / 3);
      const fqStartMonth = (fq * 3 + 1) % 12; // back to calendar month (Feb=1)
      const yr = fqStartMonth > m ? now.getFullYear() - 1 : now.getFullYear();
      const s = new Date(yr, fqStartMonth, 1).getTime();
      const e = new Date(yr, fqStartMonth + 3, 0).getTime() + day - 1;
      if (preset === 'this_fiscal_quarter') return { start: s, end: e };
      return { start: s - 3 * 31 * day, end: s - 1 }; // approximate last FQ
    }
    case 'this_year': {
      const s = new Date(now.getFullYear(), 0, 1).getTime();
      const e = new Date(now.getFullYear(), 11, 31).getTime() + day - 1;
      return { start: s, end: e };
    }
    case 'last_year': {
      const s = new Date(now.getFullYear() - 1, 0, 1).getTime();
      const e = new Date(now.getFullYear() - 1, 11, 31).getTime() + day - 1;
      return { start: s, end: e };
    }
    case 'this_fiscal_year': {
      // Fiscal year starts Feb 1
      const fyStart = now.getMonth() >= 1
        ? new Date(now.getFullYear(), 1, 1).getTime()
        : new Date(now.getFullYear() - 1, 1, 1).getTime();
      const fyEnd = fyStart + 365 * day - 1;
      return { start: fyStart, end: fyEnd };
    }
    case 'last_fiscal_year': {
      const fyStart = now.getMonth() >= 1
        ? new Date(now.getFullYear() - 1, 1, 1).getTime()
        : new Date(now.getFullYear() - 2, 1, 1).getTime();
      const fyEnd = fyStart + 365 * day - 1;
      return { start: fyStart, end: fyEnd };
    }
    default: return null;
  }
}

@Injectable()
export class CriteriaEvaluatorService {
  /** A rule passes if ANY filter group passes (OR between groups). */
  evaluateRule(rule: CriteriaRule, record: Record<string, unknown>): boolean {
    if (rule.filterGroups.length === 0) return true;
    return rule.filterGroups.some((group) => this.evaluateGroup(group, record));
  }

  /** All rules must pass (AND between rules). */
  evaluateAll(rules: CriteriaRule[], record: Record<string, unknown>): boolean {
    const active = rules.filter((r) => r.filterGroups.length > 0);
    if (active.length === 0) return true;
    return active.every((r) => this.evaluateRule(r, record));
  }

  /** Same as evaluateAll but returns per-rule/group/filter detail. */
  evaluateWithDetails(rules: CriteriaRule[], record: Record<string, unknown>): {
    passed: boolean;
    rules: Array<{
      ruleId: string;
      ruleName: string | null;
      passed: boolean;
      groups: Array<{
        passed: boolean;
        filters: Array<{ field: string; operator: string; value: unknown; actualValue: unknown; passed: boolean }>;
      }>;
    }>;
  } {
    const active = rules.filter((r) => r.filterGroups.length > 0);
    if (active.length === 0) return { passed: true, rules: [] };

    const ruleResults = active.map((rule) => {
      const groups = rule.filterGroups.map((group) => {
        const filters = group.filters.map((f) => {
          const actualValue = record[f.field] ?? null;
          return {
            field: f.field,
            operator: f.operator,
            value: f.value ?? null,
            actualValue,
            passed: this.evaluateFilter(f, record),
          };
        });
        return { passed: filters.every((f) => f.passed), filters };
      });
      return {
        ruleId: rule.id,
        ruleName: rule.ruleName,
        passed: groups.some((g) => g.passed),
        groups,
      };
    });

    return { passed: ruleResults.every((r) => r.passed), rules: ruleResults };
  }

  /** All filters within a group must pass (AND within group). */
  private evaluateGroup(group: SyncFilterGroup, record: Record<string, unknown>): boolean {
    if (group.filters.length === 0) return true;
    return group.filters.every((f) => this.evaluateFilter(f, record));
  }

  private evaluateFilter(
    filter: { field: string; operator: string; value?: unknown },
    record: Record<string, unknown>,
  ): boolean {
    const raw = record[filter.field];
    const fieldVal = raw != null ? String(raw) : '';
    const condVal = filter.value != null ? String(filter.value) : '';

    switch (filter.operator) {
      case 'EQ':
        return fieldVal.toLowerCase() === condVal.toLowerCase();
      case 'NEQ':
        return fieldVal.toLowerCase() !== condVal.toLowerCase();
      case 'CONTAINS':
        return fieldVal.toLowerCase().includes(condVal.toLowerCase());
      case 'NOT_CONTAINS':
        return !fieldVal.toLowerCase().includes(condVal.toLowerCase());
      case 'STARTS_WITH':
        return fieldVal.toLowerCase().startsWith(condVal.toLowerCase());
      case 'ENDS_WITH':
        return fieldVal.toLowerCase().endsWith(condVal.toLowerCase());
      case 'GT': {
        const n = Number(fieldVal), t = Number(condVal);
        return !isNaN(n) && !isNaN(t) && n > t;
      }
      case 'GTE': {
        const n = Number(fieldVal), t = Number(condVal);
        return !isNaN(n) && !isNaN(t) && n >= t;
      }
      case 'LT': {
        const n = Number(fieldVal), t = Number(condVal);
        return !isNaN(n) && !isNaN(t) && n < t;
      }
      case 'LTE': {
        const n = Number(fieldVal), t = Number(condVal);
        return !isNaN(n) && !isNaN(t) && n <= t;
      }
      case 'BETWEEN': {
        const n = Number(fieldVal);
        const [lo, hi] = Array.isArray(filter.value) ? (filter.value as number[]) : [null, null];
        return !isNaN(n) && lo != null && hi != null && n >= lo && n <= hi;
      }
      case 'IN': {
        const list = Array.isArray(filter.value)
          ? (filter.value as unknown[]).map(String)
          : [condVal];
        return list.some((v) => v.toLowerCase() === fieldVal.toLowerCase());
      }
      case 'NOT_IN': {
        const list = Array.isArray(filter.value)
          ? (filter.value as unknown[]).map(String)
          : [condVal];
        return !list.some((v) => v.toLowerCase() === fieldVal.toLowerCase());
      }
      case 'HAS_PROPERTY':
        return raw != null && fieldVal !== '';
      case 'NOT_HAS_PROPERTY':
        return raw == null || fieldVal === '';

      // ── Date operators ────────────────────────────────────────────────────
      case 'DATE_IS': {
        const ts = parseHsDate(fieldVal);
        if (ts == null) return false;
        const range = resolveDatePreset(condVal);
        if (!range) return false;
        return ts >= range.start && ts <= range.end;
      }
      case 'DATE_EQ': {
        const ts = parseHsDate(fieldVal);
        const target = parseHsDate(condVal);
        if (ts == null || target == null) return false;
        return startOfDay(ts) === startOfDay(target);
      }
      case 'DATE_BEFORE': {
        const ts = parseHsDate(fieldVal);
        const target = parseHsDate(condVal);
        if (ts == null || target == null) return false;
        return ts < startOfDay(target);
      }
      case 'DATE_AFTER': {
        const ts = parseHsDate(fieldVal);
        const target = parseHsDate(condVal);
        if (ts == null || target == null) return false;
        return ts > endOfDay(target);
      }
      case 'DATE_BETWEEN': {
        const ts = parseHsDate(fieldVal);
        if (ts == null) return false;
        const parts = condVal.split(',');
        if (parts.length !== 2) return false;
        const s = parseHsDate(parts[0].trim());
        const e = parseHsDate(parts[1].trim());
        if (s == null || e == null) return false;
        return ts >= startOfDay(s) && ts <= endOfDay(e);
      }
      case 'DATE_GT_DAYS': {
        const ts = parseHsDate(fieldVal);
        if (ts == null) return false;
        const days = Number(condVal);
        if (isNaN(days)) return false;
        return ts < Date.now() - days * 86_400_000;
      }
      case 'DATE_LT_DAYS': {
        const ts = parseHsDate(fieldVal);
        if (ts == null) return false;
        const days = Number(condVal);
        if (isNaN(days)) return false;
        return ts > Date.now() - days * 86_400_000;
      }

      default:
        return true;
    }
  }
}
