import * as migration_20261015_081147_initial from './20261015_081147_initial';

export const migrations = [
  {
    up: migration_20261015_081147_initial.up,
    down: migration_20261015_081147_initial.down,
    name: '20261015_081147_initial'
  },
];
