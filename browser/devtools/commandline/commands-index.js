/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const gcli = require("gcli/index");

const commandModules = [
  "resource:///modules/devtools/BuiltinCommands.jsm",
  "devtools/tilt/tilt-commands",
  "gcli/commands/appcache",
  "gcli/commands/listen",
  "gcli/commands/media",
  "gcli/commands/paintflashing",
  "gcli/commands/restart",
  "gcli/commands/screenshot",
  "gcli/commands/tools",
];

gcli.addItemsByModule(commandModules, { delayedLoad: true });

const defaultTools = require("main").defaultTools;
for (let definition of defaultTools) {
  if (definition.commands) {
    gcli.addItemsByModule(definition.commands, { delayedLoad: true });
  }
}

const { mozDirLoader } = require("resource:///modules/devtools/BuiltinCommands.jsm");

gcli.addItemsByModule("mozcmd", { delayedLoad: true, loader: mozDirLoader });
