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
    AuthModule,
    InstallationModule,
    HealthModule,
  ],
})
export class AppModule {}
