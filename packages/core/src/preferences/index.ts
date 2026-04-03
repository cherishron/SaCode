/**
 * 用户偏好模块
 */

export {
  type UserPreferences,
  type PreferenceChangeEvent,
  DEFAULT_PREFERENCES,
} from "./types";

export {
  PreferenceManager,
  createPreferenceManager,
  getPreferenceManager,
  type PreferenceManagerEvents,
} from "./manager";
