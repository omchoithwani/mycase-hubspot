import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StageMapping } from '@mycase-hubspot/db';
import { HsPipeline } from '../hubspot/dto/deal.dto';

/** Best-guess defaults when seeding from pipeline data */
const SEED_RULES: Array<{
  labelContains: string[];
  mycaseStatus: string;
}> = [
  { labelContains: ['won', 'closed won', 'close won'],       mycaseStatus: 'closed' },
  { labelContains: ['lost', 'closed lost', 'disqualified'],  mycaseStatus: 'closed' },
  { labelContains: ['pending', 'proposal', 'decision'],       mycaseStatus: 'open' },
  { labelContains: ['hold', 'on hold', 'paused'],             mycaseStatus: 'open' },
];

const DEFAULT_MYCASE_STATUS = 'open';

@Injectable()
export class StageMappingService {
  private readonly logger = new Logger(StageMappingService.name);

  constructor(
    @InjectRepository(StageMapping)
    private readonly repo: Repository<StageMapping>,
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async list(installationId: string): Promise<StageMapping[]> {
    return this.repo.find({
      where: { installationId },
      order: { hubspotPipelineId: 'ASC', hubspotStageId: 'ASC' },
    });
  }

  async upsert(
    installationId: string,
    rows: Array<{
      hubspotPipelineId: string;
      hubspotStageId: string;
      hubspotStageLabel?: string;
      mycaseStatus: string;
      direction?: string;
    }>,
  ): Promise<StageMapping[]> {
    const saved: StageMapping[] = [];

    for (const row of rows) {
      let mapping = await this.repo.findOne({
        where: {
          installationId,
          hubspotPipelineId: row.hubspotPipelineId,
          hubspotStageId: row.hubspotStageId,
        },
      });

      if (!mapping) {
        mapping = this.repo.create({
          installationId,
          hubspotPipelineId: row.hubspotPipelineId,
          hubspotStageId: row.hubspotStageId,
        });
      }

      mapping.hubspotStageLabel = row.hubspotStageLabel ?? mapping.hubspotStageLabel;
      mapping.mycaseStatus = row.mycaseStatus;
      mapping.direction = row.direction ?? 'both';

      saved.push(await this.repo.save(mapping));
    }

    return saved;
  }

  // ── Resolution (used by processors) ──────────────────────────────────────

  async toMyCaseStatus(
    installationId: string,
    pipelineId: string,
    stageId: string,
  ): Promise<string | null> {
    const mapping = await this.repo.findOne({
      where: { installationId, hubspotPipelineId: pipelineId, hubspotStageId: stageId },
    });
    return mapping?.mycaseStatus ?? null;
  }

  async toStageLabel(
    installationId: string,
    pipelineId: string,
    stageId: string,
  ): Promise<string | null> {
    const mapping = await this.repo.findOne({
      where: { installationId, hubspotPipelineId: pipelineId, hubspotStageId: stageId },
    });
    return mapping?.hubspotStageLabel ?? null;
  }

  async toHubSpotStage(
    installationId: string,
    mycaseStatus: string,
  ): Promise<{ pipelineId: string; stageId: string } | null> {
    // Prefer mappings that are exact-status matches; fall back to first match
    const mappings = await this.repo.find({ where: { installationId } });
    const match = mappings.find(
      (m) => m.mycaseStatus.toLowerCase() === mycaseStatus.toLowerCase(),
    );
    if (!match) return null;
    return {
      pipelineId: match.hubspotPipelineId,
      stageId: match.hubspotStageId,
    };
  }

  // ── Seed defaults on install ──────────────────────────────────────────────

  /**
   * Called once after HubSpot OAuth completes.
   * Creates best-guess stage mappings marked as defaults — user reviews in UI.
   */
  async seedDefaults(
    installationId: string,
    pipelines: HsPipeline[],
  ): Promise<void> {
    for (const pipeline of pipelines) {
      for (const stage of pipeline.stages) {
        const existing = await this.repo.findOne({
          where: {
            installationId,
            hubspotPipelineId: pipeline.id,
            hubspotStageId: stage.id,
          },
        });
        if (existing) continue;

        const mycaseStatus = this.guessMyCaseStatus(stage.label);

        await this.repo.save(
          this.repo.create({
            installationId,
            hubspotPipelineId: pipeline.id,
            hubspotStageId: stage.id,
            hubspotStageLabel: stage.label,
            mycaseStatus,
            direction: 'both',
          }),
        );
      }
    }
    this.logger.log(
      `Seeded stage mappings for installation ${installationId} from ${pipelines.length} pipeline(s)`,
    );
  }

  private guessMyCaseStatus(stageLabel: string): string {
    const lower = stageLabel.toLowerCase();
    for (const rule of SEED_RULES) {
      if (rule.labelContains.some((token) => lower.includes(token))) {
        return rule.mycaseStatus;
      }
    }
    return DEFAULT_MYCASE_STATUS;
  }
}
