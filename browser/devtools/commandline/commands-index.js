/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const createSystem = require("gcli/system").createSystem;
const connectFront = require("gcli/system").connectFront;
const GcliFront = require("devtools/server/actors/gcli").GcliFront;

/**
 * This is the basic list of modules that should be loaded into each
 * requisition instance whether server side or client side
 */
exports.baseModules = [
  "gcli/types/delegate",
  "gcli/types/selection",
  "gcli/types/array",

  "gcli/types/boolean",
  "gcli/types/command",
  "gcli/types/date",
  "gcli/types/file",
  "gcli/types/javascript",
  "gcli/types/node",
  "gcli/types/number",
  "gcli/types/resource",
  "gcli/types/setting",
  "gcli/types/string",
  "gcli/types/union",
  "gcli/types/url",

  "gcli/fields/fields",
  "gcli/fields/delegate",
  "gcli/fields/selection",

  "gcli/ui/focus",
  "gcli/ui/intro",

  "gcli/converters/converters",
  "gcli/converters/basic",
  "gcli/converters/terminal",

  "gcli/languages/command",
  "gcli/languages/javascript",

  "gcli/commands/context",
];

/**
 * TODO: Are they really client only modules, we should really filter with
 * runAt=client or something
 */
exports.clientModules = [
  // "gcli/cli",                  // No need for "{" with web console
  "gcli/commands/clear",
  // "gcli/commands/connect",     // We need to fix our RDP connector
  // "gcli/commands/exec",        // No exec in Firefox yet
  // "gcli/commands/global",
  "gcli/commands/help",
  // "gcli/commands/intro",       // No need for intro command
  // "gcli/commands/lang",
  // "gcli/commands/mocks",       // Only for testing
  "gcli/commands/pref",
  // "gcli/commands/preflist",    // Too slow in Firefox
  // "gcli/commands/test",        // Only for testing

  // No demo or node commands
];

/**
 * Some commands belong to a tool (see getToolModules). This is a list of the
 * modules that are *not* owned by a tool.
 */
exports.devtoolsModules = [
  "devtools/tilt/tilt-commands",
  "gcli/commands/addon",
  "gcli/commands/appcache",
  "gcli/commands/calllog",
  "gcli/commands/cmd",
  "gcli/commands/cookie",
  "gcli/commands/csscoverage",
  "gcli/commands/folder",
  "gcli/commands/highlight",
  "gcli/commands/inject",
  "gcli/commands/jsb",
  "gcli/commands/listen",
  "gcli/commands/media",
  "gcli/commands/pagemod",
  "gcli/commands/paintflashing",
  "gcli/commands/restart",
  "gcli/commands/screenshot",
  "gcli/commands/tools",
];

/**
 * Register commands from tools with 'command: [ "some/module" ]' definitions.
 * We'd like to do this:
 *
 *     const defaultTools = require("main").defaultTools;
 *     return defaultTools.map(definition => definition.commands || [])
 *                        .reduce((prev, curr) => prev.concat(curr), []);
 *
 * Except that requiring 'main' from the server causes it to attempt to
 * re-register a bunch of already registered things.
 * TODO: Find a way to require("main") without require("main")
 */
exports.devtoolsToolModules = [
  "devtools/webconsole/console-commands",
  "devtools/resize-commands",
  "devtools/inspector/inspector-commands",
  "devtools/eyedropper/commands",
  "devtools/debugger/debugger-commands",
  "devtools/styleeditor/styleeditor-commands",
  "devtools/scratchpad/scratchpad-commands",
];

/**
 * Cache of the system we created
 */
var systemForServer;

/**
 * Setup a system for use in a content process and make sure all the
 * `runAt=server` modules are registered.
 */
exports.loadForServer = function() {
  if (systemForServer == null) {
    systemForServer = createSystem({ location: "server" });

    systemForServer.addItemsByModule(exports.baseModules, { delayedLoad: true });
    systemForServer.addItemsByModule(exports.clientModules, { delayedLoad: true });
    systemForServer.addItemsByModule(exports.devtoolsModules, { delayedLoad: true });
    systemForServer.addItemsByModule(exports.devtoolsToolModules, { delayedLoad: true });

    let { mozDirLoader } = require("gcli/commands/cmd");
    systemForServer.addItemsByModule("mozcmd", { delayedLoad: true, loader: mozDirLoader });
  }

  return systemForServer.load().then(() => systemForServer);
};

/**
 * WeakMap<Target, Promise<System>>
 */
var systemForTarget = new WeakMap();

/**
 * The toolbox uses the following properties on a command to allow it to be
 * added to the toolbox toolbar
 */
var customProperties = [ "buttonId", "buttonClass", "tooltipText" ];

/**
 * Create a system which connects to a GCLI in a remote target
 */
exports.loadForTarget = function(target) {
  let promise = systemForTarget.get(target);
  if (promise != null) {
    return promise;
  }

  console.log("Creating GCLI system for " + target.url);
  let system = createSystem({ location: "client" });

  system.addItemsByModule(exports.baseModules, { delayedLoad: true });
  system.addItemsByModule(exports.clientModules, { delayedLoad: true });
  system.addItemsByModule(exports.devtoolsModules, { delayedLoad: true });
  system.addItemsByModule(exports.devtoolsToolModules, { delayedLoad: true });

  let { mozDirLoader } = require("gcli/commands/cmd");
  system.addItemsByModule("mozcmd", { delayedLoad: true, loader: mozDirLoader });

  // Load the client system
  promise = system.load().then(() => {
    return GcliFront.create(target).then(front => {
      return connectFront(system, front, customProperties).then(() => system);
    });
  });

  systemForTarget.set(target, promise);
  return promise;
};
