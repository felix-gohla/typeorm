import { ModuleMetadata, Type } from '@nestjs/common';
import { DataSource, DataSourceOptions } from 'typeorm';

export type TypeOrmModuleOptions = {
  /**
   * Number of times to retry connecting
   * Default: 10
   */
  retryAttempts?: number;
  /**
   * Delay between dataSource retry attempts (ms)
   * Default: 3000
   */
  retryDelay?: number;
  /**
   * Function that determines whether the module should
   * attempt to connect upon failure.
   *
   * @param err error that was thrown
   * @returns whether to retry dataSource or not
   */
  toRetry?: (err: any) => boolean;
  /**
   * If `true`, entities will be loaded automatically.
   */
  autoLoadEntities?: boolean;
  /**
   * If `true`, dataSource will not be closed on application shutdown.
   */
  keepDataSourceAlive?: boolean;
  /**
   * If `true`, will show verbose error messages on each dataSource retry.
   */
  verboseRetryLog?: boolean;

  /**
   * A name identifying that connection.
   */
  name?: string;
} & Partial<DataSourceOptions>;

export interface TypeOrmOptionsFactory {
  createTypeOrmOptions(
    connectionName?: string,
  ): Promise<TypeOrmModuleOptions> | TypeOrmModuleOptions;
}

export type TypeOrmDataSourceFactory = (
  options?: DataSourceOptions,
) => Promise<DataSource>;

export interface TypeOrmModuleAsyncOptions
  extends Pick<ModuleMetadata, 'imports'> {
  name?: string;
  useExisting?: Type<TypeOrmOptionsFactory>;
  useClass?: Type<TypeOrmOptionsFactory>;
  useFactory?: (
    ...args: any[]
  ) => Promise<TypeOrmModuleOptions> | TypeOrmModuleOptions;
  dataSourceFactory?: TypeOrmDataSourceFactory;
  inject?: any[];
}
