import * as migration_20261015_082203_initial from './20261015_082203_initial';

export const migrations = [
  {
    up: migration_20261015_082203_initial.up,
    down: migration_20261015_082203_initial.down,
    name: '20261015_082203_initial'
  },
];
