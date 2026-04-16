import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncCriteria } from '@mycase-hubspot/db';
import { CriteriaEvaluatorService } from './criteria-evaluator.service';

export type SourceSystem = 'hubspot' | 'mycase';

@Injectable()
export class SyncCriteriaService {
  constructor(
    @InjectRepository(SyncCriteria)
    private readonly repo: Repository<SyncCriteria>,
    private readonly evaluator: CriteriaEvaluatorService,
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async list(
    installationId: string,
    objectType?: string,
    sourceSystem?: SourceSystem,
  ): Promise<SyncCriteria[]> {
    const where: { installationId: string; objectType?: string; sourceSystem?: string } = {
      installationId,
    };
    if (objectType) where.objectType = objectType;
    if (sourceSystem) where.sourceSystem = sourceSystem;
    return this.repo.find({ where, order: { createdAt: 'ASC' } });
  }

  async create(
    installationId: string,
    data: {
      objectType: string;
      sourceSystem: SourceSystem;
      ruleName?: string;
      logicOperator?: 'AND' | 'OR';
      conditions: Array<{ field: string; operator: string; value?: unknown }>;
    },
  ): Promise<SyncCriteria> {
    const entity = this.repo.create({
      installationId,
      objectType: data.objectType,
      sourceSystem: data.sourceSystem,
      ruleName: data.ruleName ?? null,
      logicOperator: data.logicOperator ?? 'AND',
      conditions: data.conditions,
      isActive: true,
    });
    return this.repo.save(entity);
  }

  async update(
    id: string,
    installationId: string,
    data: Partial<{
      ruleName: string;
      logicOperator: 'AND' | 'OR';
      conditions: Array<{ field: string; operator: string; value?: unknown }>;
      isActive: boolean;
    }>,
  ): Promise<SyncCriteria> {
    await this.repo.update({ id, installationId }, data as any);
    return this.repo.findOneOrFail({ where: { id } });
  }

  async remove(id: string, installationId: string): Promise<void> {
    await this.repo.delete({ id, installationId });
  }

  // ── Evaluation ────────────────────────────────────────────────────────────

  async evaluate(
    installationId: string,
    objectType: string,
    sourceSystem: SourceSystem,
    record: Record<string, unknown>,
  ): Promise<boolean> {
    const rules = await this.repo.find({
      where: { installationId, objectType, sourceSystem, isActive: true },
    });
    if (rules.length === 0) return true;

    return this.evaluator.evaluateAll(
      rules.map((r) => ({
        id: r.id,
        ruleName: r.ruleName,
        logicOperator: r.logicOperator as 'AND' | 'OR',
        conditions: r.conditions as Array<{ field: string; operator: any; value?: unknown }>,
      })),
      record,
    );
  }

  async testRule(
    id: string,
    installationId: string,
    record: Record<string, unknown>,
  ): Promise<{ passed: boolean; ruleId: string; ruleName: string | null }> {
    const rule = await this.repo.findOneOrFail({ where: { id, installationId } });
    const passed = this.evaluator.evaluateRule(
      {
        id: rule.id,
        ruleName: rule.ruleName,
        logicOperator: rule.logicOperator as 'AND' | 'OR',
        conditions: rule.conditions as Array<{ field: string; operator: any; value?: unknown }>,
      },
      record,
    );
    return { passed, ruleId: id, ruleName: rule.ruleName };
  }
}
