import { createNamespace, getNamespace, Namespace } from 'cls-hooked';
import { Connection, EntityManager, Repository } from 'typeorm';
import { EventEmitter } from 'events';
import { TypeOrmUpdatedPatchError } from '../errors/typeorm-updated-patch';
import { isDataSource } from '../utils';
import {
  NAMESPACE_NAME,
  TYPEORM_CONNECTION_NAME,
  TYPEORM_CONNECTION_NAME_PREFIX,
  TYPEORM_ENTITY_MANAGER_NAME,
  TYPEORM_HOOK_NAME,
} from '../consts';

export type ConnectionName = string | 'default';

/**
 * Options to adjust and manage this library
 */
interface TypeormTransactionalOptions {
  /**
   * Controls how many hooks (`commit`, `rollback`, `complete`) can be used simultaneously.
   * If you exceed the number of hooks of same type, you get a warning. This is a useful to find possible memory leaks.
   * You can set this options to `0` or `Infinity` to indicate an unlimited number of listeners.
   */
  maxHookHandlers: number;
}

/**
 * Global data and state
 */
interface TypeormTransactionalData {
  options: TypeormTransactionalOptions;
}

interface AddTransactionalConnectionInput {
  /**
   * Custom name for data source
   */
  name?: ConnectionName;
  connection: Connection;
  /**
   * Whether to "patch" some `DataSource` methods to support their usage in transactions (default `true`).
   *
   * If you don't need to use `DataSource` methods in transactions and you only work with `Repositories`,
   * you can set this flag to `false`.
   */
  patch?: boolean;
}

const connections = new Map<ConnectionName, Connection>();

/**
 * Default library's state
 */
const data: TypeormTransactionalData = {
  options: {
    maxHookHandlers: 10,
  },
};

export const getTransactionalContext = () => getNamespace(NAMESPACE_NAME);

export const getEntityManagerByConnectionName = (
  context: Namespace,
  connectionName: ConnectionName,
) => {
  if (!connections.has(connectionName)) return null;

  return (context.get(TYPEORM_CONNECTION_NAME_PREFIX + connectionName) as EntityManager) || null;
};

export const setEntityManagerByConnectionName = (
  context: Namespace,
  connectionName: ConnectionName,
  entityManager: EntityManager | null,
) => {
  if (!connections.has(connectionName)) return;

  context.set(TYPEORM_CONNECTION_NAME_PREFIX + connectionName, entityManager);
};

const getEntityManagerInContext = (connectionName: ConnectionName) => {
  const context = getTransactionalContext();
  if (!context || !context.active) return null;

  return getEntityManagerByConnectionName(context, connectionName);
};

const patchConnection = (connection: Connection) => {
  let originalManager = connection.manager;

  Object.defineProperty(connection, 'manager', {
    configurable: true,
    get() {
      return (
        getEntityManagerInContext(this[TYPEORM_CONNECTION_NAME] as ConnectionName) ||
        originalManager
      );
    },
    set(manager: EntityManager) {
      originalManager = manager;
    },
  });

  const originalQuery = Connection.prototype.query;
  if (originalQuery.length !== 3) {
    throw new TypeOrmUpdatedPatchError();
  }

  connection.query = function (...args: unknown[]) {
    args[2] = args[2] || this.manager?.queryRunner;

    return originalQuery.apply(this, args);
  };

  const originalCreateQueryBuilder = Connection.prototype.createQueryBuilder;
  if (originalCreateQueryBuilder.length !== 3) {
    throw new TypeOrmUpdatedPatchError();
  }

  connection.createQueryBuilder = function (...args: unknown[]) {
    if (args.length === 0) {
      return originalCreateQueryBuilder.apply(this, [this.manager?.queryRunner]);
    }

    args[2] = args[2] || this.manager?.queryRunner;

    return originalCreateQueryBuilder.apply(this, args);
  };

  connection.transaction = function (...args: unknown[]) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return originalManager.transaction(...args);
  };
};

const setTransactionalOptions = (options?: Partial<TypeormTransactionalOptions>) => {
  data.options = { ...data.options, ...(options || {}) };
};

export const getTransactionalOptions = () => data.options;

export const initializeTransactionalContext = (options?: Partial<TypeormTransactionalOptions>) => {
  setTransactionalOptions(options);

  const patchManager = (repositoryType: unknown) => {
    Object.defineProperty(repositoryType, 'manager', {
      configurable: true,
      get() {
        return (
          getEntityManagerInContext(
            this[TYPEORM_ENTITY_MANAGER_NAME].connection[TYPEORM_CONNECTION_NAME] as ConnectionName,
          ) || this[TYPEORM_ENTITY_MANAGER_NAME]
        );
      },
      set(manager: EntityManager | undefined) {
        this[TYPEORM_ENTITY_MANAGER_NAME] = manager;
      },
    });
  };

  const getRepository = (originalFn: (args: unknown) => unknown) => {
    return function patchRepository(...args: unknown[]) {
      const repository = originalFn.apply(this, args);

      if (!(TYPEORM_ENTITY_MANAGER_NAME in repository)) {
        /**
         * Store current manager
         */
        repository[TYPEORM_ENTITY_MANAGER_NAME] = repository.manager;

        /**
         * Patch repository object
         */
        patchManager(repository);
      }

      return repository;
    };
  };

  const originalGetRepository = EntityManager.prototype.getRepository;

  EntityManager.prototype.getRepository = getRepository(originalGetRepository);

  patchManager(Repository.prototype);

  return createNamespace(NAMESPACE_NAME) || getNamespace(NAMESPACE_NAME);
};

export const addTransactionalDataSource = (input: Connection | AddTransactionalConnectionInput) => {
  if (isDataSource(input)) {
    input = { name: 'default', connection: input, patch: true };
  }

  const { name = 'default', connection, patch = true } = input;
  if (connections.has(name)) {
    throw new Error(`DataSource with name "${name}" has already added.`);
  }

  if (patch) {
    patchConnection(connection);
  }

  connections.set(name, connection);
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  connection[TYPEORM_DATA_SOURCE_NAME] = name;

  return input.connection;
};

export const getConnectionByName = (name: ConnectionName) => connections.get(name);

export const deleteConnectionByName = (name: ConnectionName) => connections.delete(name);

export const getHookInContext = (context: Namespace | undefined) =>
  context?.get(TYPEORM_HOOK_NAME) as EventEmitter | null;

export const setHookInContext = (context: Namespace, emitter: EventEmitter | null) =>
  context.set(TYPEORM_HOOK_NAME, emitter);
