import { Injectable } from '@nestjs/common';

type LogicOperator = 'AND' | 'OR';
type Operator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater_than'
  | 'less_than'
  | 'in'
  | 'not_in'
  | 'is_set'
  | 'is_not_set';

interface Condition {
  field: string;
  operator: Operator;
  value?: unknown;
}

export interface CriteriaRule {
  id: string;
  ruleName: string | null;
  logicOperator: LogicOperator;
  conditions: Condition[];
}

@Injectable()
export class CriteriaEvaluatorService {
  evaluateRule(rule: CriteriaRule, record: Record<string, unknown>): boolean {
    if (rule.conditions.length === 0) return true;
    const results = rule.conditions.map((c) => this.evaluateCondition(c, record));
    return rule.logicOperator === 'OR'
      ? results.some(Boolean)
      : results.every(Boolean);
  }

  evaluateAll(rules: CriteriaRule[], record: Record<string, unknown>): boolean {
    if (rules.length === 0) return true;
    return rules.filter((r) => r.conditions.length > 0).every((r) => this.evaluateRule(r, record));
  }

  private evaluateCondition(cond: Condition, record: Record<string, unknown>): boolean {
    const raw = record[cond.field];
    const fieldVal = raw != null ? String(raw) : '';
    const condVal = cond.value != null ? String(cond.value) : '';

    switch (cond.operator) {
      case 'equals':
        return fieldVal.toLowerCase() === condVal.toLowerCase();
      case 'not_equals':
        return fieldVal.toLowerCase() !== condVal.toLowerCase();
      case 'contains':
        return fieldVal.toLowerCase().includes(condVal.toLowerCase());
      case 'not_contains':
        return !fieldVal.toLowerCase().includes(condVal.toLowerCase());
      case 'greater_than': {
        const n = Number(fieldVal), t = Number(condVal);
        return !isNaN(n) && !isNaN(t) && n > t;
      }
      case 'less_than': {
        const n = Number(fieldVal), t = Number(condVal);
        return !isNaN(n) && !isNaN(t) && n < t;
      }
      case 'in': {
        const list = Array.isArray(cond.value) ? (cond.value as unknown[]).map(String) : [condVal];
        return list.some((v) => v.toLowerCase() === fieldVal.toLowerCase());
      }
      case 'not_in': {
        const list = Array.isArray(cond.value) ? (cond.value as unknown[]).map(String) : [condVal];
        return !list.some((v) => v.toLowerCase() === fieldVal.toLowerCase());
      }
      case 'is_set':
        return raw != null && fieldVal !== '';
      case 'is_not_set':
        return raw == null || fieldVal === '';
      default:
        return true;
    }
  }
}
