import * as migration_20261016_041541_initial from './20261016_041541_initial';
import * as migration_20261016_050002_clients_and_configs from './20261016_050002_clients_and_configs';

export const migrations = [
  {
    up: migration_20261016_041541_initial.up,
    down: migration_20261016_041541_initial.down,
    name: '20261016_041541_initial',
  },
  {
    up: migration_20261016_050002_clients_and_configs.up,
    down: migration_20261016_050002_clients_and_configs.down,
    name: '20261016_050002_clients_and_configs'
  },
];
