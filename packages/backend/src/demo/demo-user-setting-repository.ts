import type { UserSettingRepository, UserSettingWrite } from '../repositories/user-setting';
import type { DemoStore } from './demo-store';

/** The store key of one user's setting; the NUL byte cannot occur in either part. */
function settingKey(user: string, key: string): string {
  return `${user}\u0000${key}`;
}

/** `hf_user_setting` of the demo data: values stored as JSON, like the MySQL table. */
export class DemoUserSettingRepository implements UserSettingRepository {
  constructor(private readonly store: DemoStore) {}

  async get(user: string, key: string): Promise<unknown | undefined> {
    const json: string | undefined = this.store.userSettings.get(settingKey(user, key));
    return json === undefined ? undefined : JSON.parse(json);
  }

  async put(params: UserSettingWrite): Promise<void> {
    const json: string | undefined = JSON.stringify(params.value);
    // `value` is NOT NULL in MySQL; a value JSON cannot represent is refused there too.
    if (json === undefined) throw new Error(`The setting ${params.key} has no JSON value`);
    this.store.userSettings.set(settingKey(params.user, params.key), json);
  }

  async delete(user: string, key: string): Promise<void> {
    this.store.userSettings.delete(settingKey(user, key));
  }
}
