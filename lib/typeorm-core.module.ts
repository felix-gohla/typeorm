import {
  DynamicModule,
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
  Provider,
  Type,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { defer, lastValueFrom, of } from 'rxjs';
import {
  DataSource,
  DataSourceOptions,
  createConnection,
  getConnectionManager,
} from 'typeorm';
import {
  generateString,
  getDataSourceName,
  getDataSourceToken,
  getEntityManagerToken,
  handleRetry,
} from './common/typeorm.utils';
import { EntitiesMetadataStorage } from './entities-metadata.storage';
import {
  TypeOrmDataSourceFactory,
  TypeOrmModuleAsyncOptions,
  TypeOrmModuleOptions,
  TypeOrmOptionsFactory,
} from './interfaces/typeorm-options.interface';
import { TYPEORM_MODULE_ID, TYPEORM_MODULE_OPTIONS } from './typeorm.constants';

@Global()
@Module({})
export class TypeOrmCoreModule implements OnApplicationShutdown {
  private readonly logger = new Logger('TypeOrmModule');

  constructor(
    @Inject(TYPEORM_MODULE_OPTIONS)
    private readonly options: TypeOrmModuleOptions,
    private readonly moduleRef: ModuleRef,
  ) {}

  static forRoot(options: TypeOrmModuleOptions = {}): DynamicModule {
    const typeOrmModuleOptions = {
      provide: TYPEORM_MODULE_OPTIONS,
      useValue: options,
    };
    const dataSourceProvider = {
      provide: getDataSourceToken(options as DataSourceOptions),
      useFactory: async () => await this.createDataSourceFactory(options),
    };

    const entityManagerProvider = this.createEntityManagerProvider(
      options as DataSourceOptions,
    );
    return {
      module: TypeOrmCoreModule,
      providers: [
        entityManagerProvider,
        dataSourceProvider,
        typeOrmModuleOptions,
      ],
      exports: [entityManagerProvider, dataSourceProvider],
    };
  }

  static forRootAsync(options: TypeOrmModuleAsyncOptions): DynamicModule {
    const dataSourceProvider = {
      provide: getDataSourceToken(options as DataSourceOptions) as string,
      useFactory: async (typeOrmOptions: TypeOrmModuleOptions) => {
        return await this.createDataSourceFactory(
          typeOrmOptions,
          options.dataSourceFactory,
        );
      },
      inject: [TYPEORM_MODULE_OPTIONS],
    };
    const entityManagerProvider = {
      provide: getEntityManagerToken(options as DataSourceOptions) as string,
      useFactory: (dataSource: DataSource) => dataSource.manager,
      inject: [getDataSourceToken(options as DataSourceOptions)],
    };

    const asyncProviders = this.createAsyncProviders(options);
    return {
      module: TypeOrmCoreModule,
      imports: options.imports,
      providers: [
        ...asyncProviders,
        entityManagerProvider,
        dataSourceProvider,
        {
          provide: TYPEORM_MODULE_ID,
          useValue: generateString(),
        },
      ],
      exports: [entityManagerProvider, dataSourceProvider],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.options.keepDataSourceAlive) {
      return;
    }
    const dataSource = this.moduleRef.get<DataSource>(
      getDataSourceToken(this.options as DataSourceOptions) as Type<DataSource>,
    );
    try {
      dataSource && (await dataSource.close());
    } catch (e) {
      this.logger.error(e?.message);
    }
  }

  private static createAsyncProviders(
    options: TypeOrmModuleAsyncOptions,
  ): Provider[] {
    if (options.useExisting || options.useFactory) {
      return [this.createAsyncOptionsProvider(options)];
    }
    const useClass = options.useClass as Type<TypeOrmOptionsFactory>;
    return [
      this.createAsyncOptionsProvider(options),
      {
        provide: useClass,
        useClass,
      },
    ];
  }

  private static createAsyncOptionsProvider(
    options: TypeOrmModuleAsyncOptions,
  ): Provider {
    if (options.useFactory) {
      return {
        provide: TYPEORM_MODULE_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject || [],
      };
    }
    // `as Type<TypeOrmOptionsFactory>` is a workaround for microsoft/TypeScript#31603
    const inject = [
      (options.useClass || options.useExisting) as Type<TypeOrmOptionsFactory>,
    ];
    return {
      provide: TYPEORM_MODULE_OPTIONS,
      useFactory: async (optionsFactory: TypeOrmOptionsFactory) =>
        await optionsFactory.createTypeOrmOptions(options.name),
      inject,
    };
  }

  private static createEntityManagerProvider(
    options: DataSourceOptions,
  ): Provider {
    return {
      provide: getEntityManagerToken(options) as string,
      useFactory: (dataSource: DataSource) => dataSource.manager,
      inject: [getDataSourceToken(options)],
    };
  }

  private static async createDataSourceFactory(
    options: TypeOrmModuleOptions,
    dataSourceFactory?: TypeOrmDataSourceFactory,
  ): Promise<DataSource> {
    const dataSourceToken = getDataSourceName(options as DataSourceOptions);
    const createTypeormDataSource = dataSourceFactory ?? createConnection;
    return await lastValueFrom(
      defer(() => {
        try {
          if (options.keepDataSourceAlive) {
            const dataSourceName = getDataSourceName(
              options as DataSourceOptions,
            );
            const manager = getConnectionManager();
            if (manager.has(dataSourceName)) {
              const dataSource = manager.get(dataSourceName);
              if (dataSource.isInitialized) {
                return of(dataSource);
              }
            }
          }
        } catch {}

        if (!options.type) {
          return createTypeormDataSource();
        }
        if (!options.autoLoadEntities) {
          return createTypeormDataSource(options as DataSourceOptions);
        }

        let entities = typeof options.entities === 'object' ? Object.values(options.entities) : options.entities;
        if (entities) {
          entities = entities.concat(
            EntitiesMetadataStorage.getEntitiesByDataSource(dataSourceToken),
          );
        } else {
          entities =
            EntitiesMetadataStorage.getEntitiesByDataSource(dataSourceToken);
        }
        return createTypeormDataSource({
          ...options,
          entities,
        } as DataSourceOptions);
      }).pipe(
        handleRetry(
          options.retryAttempts,
          options.retryDelay,
          dataSourceToken,
          options.verboseRetryLog,
          options.toRetry,
        ),
      ),
    );
  }
}
