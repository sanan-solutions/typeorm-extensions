export class TypeOrmUpdatedPatchError extends Error {
  public name = 'TypeOrmUpdatedPatchError';

  constructor() {
    super(
      'It seems that TypeORM was updated. Patching "Connection" is not safe. If you want to try to use the library, set the "patch" flag in the function "addTransactionalConnection" to "false".',
    );
  }
}
