import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FieldMapping } from '@mycase-hubspot/db';
import {
  ObjectType,
  SyncDirection,
  DEFAULT_FIELD_MAPPINGS,
} from '@mycase-hubspot/shared-types';
import { FieldTransformerService } from './field-transformer.service';

@Injectable()
export class FieldMappingService {
  constructor(
    @InjectRepository(FieldMapping)
    private readonly repo: Repository<FieldMapping>,
    private readonly transformer: FieldTransformerService,
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async list(
    installationId: string,
    objectType?: ObjectType,
  ): Promise<FieldMapping[]> {
    const where: { installationId: string; objectType?: ObjectType } = { installationId };
    if (objectType) where.objectType = objectType;
    return this.repo.find({ where, order: { objectType: 'ASC', hubspotField: 'ASC' } });
  }

  async create(
    installationId: string,
    data: {
      objectType: ObjectType;
      hubspotField: string;
      mycaseField: string;
      direction?: string;
      transformType?: string;
      transformConfig?: Record<string, unknown>;
      isRequired?: boolean;
    },
  ): Promise<FieldMapping> {
    const mapping = this.repo.create({
      installationId,
      objectType: data.objectType,
      hubspotField: data.hubspotField,
      mycaseField: data.mycaseField,
      direction: data.direction ?? 'both',
      transformType: data.transformType ?? 'direct',
      transformConfig: data.transformConfig ?? null,
      isRequired: data.isRequired ?? false,
    });
    return this.repo.save(mapping);
  }

  async update(
    installationId: string,
    mappingId: string,
    data: Partial<{
      direction: string;
      transformType: string;
      transformConfig: Record<string, unknown>;
      isRequired: boolean;
    }>,
  ): Promise<FieldMapping> {
    const mapping = await this.repo.findOne({
      where: { id: mappingId, installationId },
    });
    if (!mapping) throw new NotFoundException(`FieldMapping ${mappingId} not found`);
    Object.assign(mapping, data);
    return this.repo.save(mapping);
  }

  async remove(installationId: string, mappingId: string): Promise<void> {
    const mapping = await this.repo.findOne({
      where: { id: mappingId, installationId },
    });
    if (!mapping) throw new NotFoundException(`FieldMapping ${mappingId} not found`);
    await this.repo.remove(mapping);
  }

  // ── Seed defaults ─────────────────────────────────────────────────────────

  async seedDefaults(installationId: string): Promise<void> {
    for (const def of DEFAULT_FIELD_MAPPINGS) {
      const exists = await this.repo.findOne({
        where: {
          installationId,
          objectType: def.objectType,
          hubspotField: def.hubspotField,
          mycaseField: def.mycaseField,
        },
      });
      if (!exists) {
        await this.repo.save(
          this.repo.create({
            installationId,
            objectType: def.objectType,
            hubspotField: def.hubspotField,
            mycaseField: def.mycaseField,
            direction: def.direction,
            transformType: def.transformType,
            transformConfig: null,
            isRequired: ['email', 'firstname', 'dealname', 'hs_note_body'].includes(
              def.hubspotField,
            ),
          }),
        );
      }
    }
  }

  // ── Apply mapping ─────────────────────────────────────────────────────────

  /**
   * Transforms a source record into a destination record using stored
   * field mappings for the given installation, objectType, and direction.
   */
  async applyMapping(
    installationId: string,
    objectType: ObjectType,
    direction: SyncDirection,
    sourceData: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const mappings = await this.list(installationId, objectType);

    // Filter to mappings applicable for this direction
    const applicable = mappings.filter(
      (m) => m.direction === 'both' || m.direction === direction,
    );

    const result: Record<string, unknown> = {};

    for (const mapping of applicable) {
      const sourceField =
        direction === 'hs_to_mc' ? mapping.hubspotField : mapping.mycaseField;
      const destField =
        direction === 'hs_to_mc' ? mapping.mycaseField : mapping.hubspotField;

      const rawValue = this.transformer.getNestedValue(sourceData, sourceField);
      if (rawValue === undefined || rawValue === null) continue;

      const transformed = this.transformer.transform(
        rawValue,
        mapping.transformType as any,
        mapping.transformConfig,
        direction,
      );

      if (transformed !== undefined) {
        this.transformer.setNestedValue(result, destField, transformed);
      }
    }

    return result;
  }

  // ── Test utility ──────────────────────────────────────────────────────────

  testTransform(
    value: unknown,
    transformType: string,
    transformConfig: Record<string, unknown> | null,
    direction: SyncDirection,
  ): unknown {
    return this.transformer.transform(
      value,
      transformType as any,
      transformConfig,
      direction,
    );
  }
}
