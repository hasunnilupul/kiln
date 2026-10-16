import * as migration_20261015_082203_initial from './20261015_082203_initial';
import * as migration_20261015_085059_sale_finalise from './20261015_085059_sale_finalise';

export const migrations = [
  {
    up: migration_20261015_082203_initial.up,
    down: migration_20261015_082203_initial.down,
    name: '20261015_082203_initial',
  },
  {
    up: migration_20261015_085059_sale_finalise.up,
    down: migration_20261015_085059_sale_finalise.down,
    name: '20261015_085059_sale_finalise'
  },
];
