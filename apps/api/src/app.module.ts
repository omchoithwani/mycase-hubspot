import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import * as Joi from 'joi';

import { AuthModule } from './auth/auth.module';
import { InstallationModule } from './installation/installation.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './common/redis.module';
import { HubSpotModule } from './hubspot/hubspot.module';
import { MyCaseModule } from './mycase/mycase.module';
import { QueueModule } from './queue/queue.module';
import { SyncModule } from './sync/sync.module';
import { FieldMappingModule } from './field-mapping/field-mapping.module';
import { StageMappingModule } from './stage-mapping/stage-mapping.module';
import { SyncCriteriaModule } from './sync-criteria/sync-criteria.module';
import { ErrorLogModule } from './error-log/error-log.module';
import { CrmCardModule } from './crm-card/crm-card.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        API_PORT: Joi.number().default(3001),
        APP_URL: Joi.string().required(),
        WEB_URL: Joi.string().required(),
        DATABASE_URL: Joi.string().required(),
        REDIS_URL: Joi.string().required(),
        ENCRYPTION_KEY: Joi.string().length(64).required(),
        HUBSPOT_CLIENT_ID: Joi.string().required(),
        HUBSPOT_CLIENT_SECRET: Joi.string().required(),
        HUBSPOT_APP_ID: Joi.string().required(),
        HUBSPOT_SCOPES: Joi.string().required(),
        MYCASE_CLIENT_ID: Joi.string().required(),
        MYCASE_CLIENT_SECRET: Joi.string().required(),
        MYCASE_REDIRECT_URI: Joi.string().required(),
      }),
    }),

    WinstonModule.forRoot({
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, context }) => {
              return `${timestamp} [${context || 'App'}] ${level}: ${message}`;
            }),
          ),
        }),
      ],
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        ssl:
          config.get('NODE_ENV') === 'production'
            ? { rejectUnauthorized: false }
            : false,
        autoLoadEntities: true,
        synchronize: false,
        migrations: ['dist/migrations/*.js'],
        migrationsRun: false,
      }),
    }),

    ScheduleModule.forRoot(),

    RedisModule,
    QueueModule,
    AuthModule,
    InstallationModule,
    HubSpotModule,
    MyCaseModule,
    SyncModule,
    FieldMappingModule,
    StageMappingModule,
    SyncCriteriaModule,
    ErrorLogModule,
    CrmCardModule,
    HealthModule,
  ],
})
export class AppModule {}
