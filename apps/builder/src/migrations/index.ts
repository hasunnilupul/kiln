import * as migration_20261016_041541_initial from './20261016_041541_initial';

export const migrations = [
  {
    up: migration_20261016_041541_initial.up,
    down: migration_20261016_041541_initial.down,
    name: '20261016_041541_initial'
  },
];
