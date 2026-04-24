import { Injectable } from '@nestjs/common';
import { SyncFilterGroup } from '@mycase-hubspot/db';

export interface CriteriaRule {
  id: string;
  ruleName: string | null;
  filterGroups: SyncFilterGroup[];
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
      default:
        return true;
    }
  }
}
