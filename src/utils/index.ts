import { Connection } from 'typeorm';

export const isDataSource = (value: unknown): value is Connection => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return value.constructor.name === Connection.name;
};
