import type React from "react";

import { common } from "./common";
import { dialogs } from "./dialogs";
import { font } from "./font";
import { kanban } from "./kanban";
import { layout } from "./layout";
import { panels } from "./panels";
import { task } from "./task";
import { terminal } from "./terminal";

const s = {
  ...layout,
  ...panels,
  ...terminal,
  ...dialogs,
  ...task,
  ...common,
  ...font,
  ...kanban,
} satisfies Record<string, React.CSSProperties>;

export default s;

export {
  common,
  dialogs,
  font,
  kanban,
  layout,
  panels,
  task,
  terminal,
};
