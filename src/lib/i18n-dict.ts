// English dictionary, assembled from per-area modules (one per page/feature)
// so translations can be edited independently without merge conflicts. Keys are
// the verbatim Japanese source strings used in the components.

import { d as shared } from "./i18n/shared";
import { d as home } from "./i18n/home";
import { d as swing } from "./i18n/swing";
import { d as approach } from "./i18n/approach";
import { d as coach } from "./i18n/coach";
import { d as progress } from "./i18n/progress";
import { d as conditions } from "./i18n/conditions";
import { d as ghost } from "./i18n/ghost";
import { d as profile } from "./i18n/profile";
import { d as tracer } from "./i18n/tracer";
import { d as cross } from "./i18n/cross";
import { d as sync } from "./i18n/sync";
import { d as silhouette } from "./i18n/silhouette";
import { d as match } from "./i18n/match";
import { d as homeDrills } from "./i18n/home_drills";
import { d as errors } from "./i18n/errors";
import { d as golf } from "./i18n/golf";
import { d as components } from "./i18n/components";

export const EN: Record<string, string> = {
  ...shared,
  ...home,
  ...swing,
  ...approach,
  ...coach,
  ...progress,
  ...conditions,
  ...ghost,
  ...profile,
  ...tracer,
  ...cross,
  ...sync,
  ...silhouette,
  ...match,
  ...homeDrills,
  ...errors,
  ...golf,
  ...components,
};
