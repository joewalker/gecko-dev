/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const defaultTools = require("main").defaultTools;
const api = require('gcli/api');

/**
 * This is the basic list of modules that should be loaded into each
 * requisition instance
 */
exports.baseModules = [
  'gcli/types/delegate',
  'gcli/types/selection',
  'gcli/types/array',

  'gcli/types/boolean',
  'gcli/types/command',
  'gcli/types/date',
  'gcli/types/file',
  'gcli/types/javascript',
  'gcli/types/node',
  'gcli/types/number',
  'gcli/types/resource',
  'gcli/types/setting',
  'gcli/types/string',
  'gcli/types/union',
  'gcli/types/url',

  'gcli/fields/fields',
  'gcli/fields/delegate',
  'gcli/fields/selection',

  'gcli/ui/focus',
  'gcli/ui/intro',

  'gcli/converters/converters',
  'gcli/converters/basic',
  // 'gcli/converters/html',      // Prevent use of innerHTML
  'gcli/converters/terminal',

  'gcli/languages/command',
  'gcli/languages/javascript',

  // 'gcli/connectors/direct',    // No need for loopback testing
  // 'gcli/connectors/rdp',       // Needs fixing
  // 'gcli/connectors/websocket', // Not from chrome
  // 'gcli/connectors/xhr',       // Not from chrome

  // 'gcli/cli',                  // No need for '{' with web console
  'gcli/commands/clear',
  // 'gcli/commands/connect',     // We need to fix our RDP connector
  'gcli/commands/context',
  // 'gcli/commands/exec',        // No exec in Firefox yet
  'gcli/commands/global',
  'gcli/commands/help',
  // 'gcli/commands/intro',       // No need for intro command
  'gcli/commands/lang',
  // 'gcli/commands/mocks',       // Only for testing
  'gcli/commands/pref',
  // 'gcli/commands/preflist',    // Too slow in Firefox
  // 'gcli/commands/test',        // Only for testing

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
 * Find the tools that have 'command: [ "some/module" ]' definitions, and
 * flatten them into a single array of module names.
 */
exports.getToolModules = function() {
  return defaultTools.map(definition => definition.commands || [])
                     .reduce((prev, curr) => prev.concat(curr), []);
};

/**
 * Builds on #getModuleNames() by registering the items with GCLI including
 * the items that come from the mozcmd directory
 */
exports.addAllItems = function(system) {
  system.addItemsByModule(exports.baseModules, { delayedLoad: true });
  system.addItemsByModule(exports.devtoolsModules, { delayedLoad: true });
  system.addItemsByModule(exports.getToolModules(), { delayedLoad: true });

  let { mozDirLoader } = require("gcli/commands/cmd");
  system.addItemsByModule("mozcmd", { delayedLoad: true, loader: mozDirLoader });
};

/**
 * Cache of the system we created
 */
var system;

/**
 * Setup a system if we need to and make sure all the registered modules are
 * loaded.
 */
exports.load = function() {
  if (system == null) {
    console.log('Creating GCLI system');
    system = api.createSystem();
    exports.addAllItems(system);
  }

  return system.load().then(() => system);
};
