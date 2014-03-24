/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = [];

const require = Components.utils.import("resource://gre/modules/devtools/Loader.jsm", {}).devtools.require;

const gcli = require("gcli/index");

const commandModules = [
  "resource:///modules/devtools/BuiltinCommands.jsm",
  "devtools/debugger/debugger-commands",
  "devtools/styleeditor/styleeditor-commands",
  "devtools/inspector/inspector-commands",
  "devtools/responsivedesign/resize-commands",
  "devtools/tilt/tilt-commands",
  "resource:///modules/devtools/CmdScratchpad.jsm",
  "devtools/profiler/commands.js",
];

gcli.addItemsByModule(commandModules, { delayedLoad: true });


const { mozDirLoader } = require("resource:///modules/devtools/BuiltinCommands.jsm");

gcli.addItemsByModule("mozcmd", { delayedLoad: true, loader: mozDirLoader });
