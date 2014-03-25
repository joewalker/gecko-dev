/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

const BRAND_SHORT_NAME = Cc["@mozilla.org/intl/stringbundle;1"]
                           .getService(Ci.nsIStringBundleService)
                           .createBundle("chrome://branding/locale/brand.properties")
                           .GetStringFromName("brandShortName");

this.EXPORTED_SYMBOLS = [ "CmdAddonFlags", "mozDirLoader", "DEFAULT_DEBUG_PORT", "connect", "items" ];

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
let promise = Cu.import("resource://gre/modules/commonjs/sdk/core/promise.js").Promise;
Cu.import("resource://gre/modules/osfile.jsm");

Cu.import("resource://gre/modules/devtools/event-emitter.js");

let devtools = Cu.import("resource://gre/modules/devtools/Loader.jsm", {}).devtools;
let gcli = devtools.require("gcli/index");
let Telemetry = devtools.require("devtools/shared/telemetry");
let telemetry = new Telemetry();

XPCOMUtils.defineLazyModuleGetter(this, "gDevTools",
                                  "resource:///modules/devtools/gDevTools.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "AppCacheUtils",
                                  "resource:///modules/devtools/AppCacheUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Downloads",
                                  "resource://gre/modules/Downloads.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Task",
                                  "resource://gre/modules/Task.jsm");

/**
 * The commands and converters that are exported to GCLI
 */
this.items = [];

