import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncCriteria, SyncFilterGroup } from '@mycase-hubspot/db';
import { CriteriaEvaluatorService } from './criteria-evaluator.service';

export type SourceSystem = 'hubspot' | 'mycase';

@Injectable()
export class SyncCriteriaService {
  constructor(
    @InjectRepository(SyncCriteria)
    private readonly repo: Repository<SyncCriteria>,
    private readonly evaluator: CriteriaEvaluatorService,
  ) {}

  async list(
    installationId: string,
    objectType?: string,
    sourceSystem?: SourceSystem,
  ): Promise<SyncCriteria[]> {
    const where: Record<string, unknown> = { installationId };
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
      filterGroups: SyncFilterGroup[];
    },
  ): Promise<SyncCriteria> {
    const entity = this.repo.create({
      installationId,
      objectType: data.objectType,
      sourceSystem: data.sourceSystem,
      ruleName: data.ruleName ?? null,
      logicOperator: 'AND',
      conditions: data.filterGroups,
      isActive: true,
    });
    return this.repo.save(entity);
  }

  async update(
    id: string,
    installationId: string,
    data: Partial<{
      ruleName: string;
      filterGroups: SyncFilterGroup[];
      isActive: boolean;
    }>,
  ): Promise<SyncCriteria> {
    const patch: Record<string, unknown> = {};
    if (data.ruleName !== undefined) patch.ruleName = data.ruleName;
    if (data.filterGroups !== undefined) patch.conditions = data.filterGroups;
    if (data.isActive !== undefined) patch.isActive = data.isActive;
    await this.repo.update({ id, installationId }, patch as any);
    return this.repo.findOneOrFail({ where: { id } });
  }

  async remove(id: string, installationId: string): Promise<void> {
    await this.repo.delete({ id, installationId });
  }

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
        filterGroups: r.conditions as SyncFilterGroup[],
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
        filterGroups: rule.conditions as SyncFilterGroup[],
      },
      record,
    );
    return { passed, ruleId: id, ruleName: rule.ruleName };
  }
}
