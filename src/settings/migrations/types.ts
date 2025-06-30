// Migration interface
export interface SettingsMigrator<TFrom = unknown, TTo = unknown> {
  version: number;
  migrate: (data: TFrom) => TTo;
}
