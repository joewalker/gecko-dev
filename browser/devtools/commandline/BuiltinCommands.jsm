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

/* CmdAddon ---------------------------------------------------------------- */

(function(module) {
  XPCOMUtils.defineLazyModuleGetter(this, "AddonManager",
                                    "resource://gre/modules/AddonManager.jsm");

  // We need to use an object in which to store any flags because a primitive
  // would remain undefined.
  module.CmdAddonFlags = {
    addonsLoaded: false
  };

  /**
   * 'addon' command.
   */
  this.items.push({
    name: "addon",
    description: gcli.lookup("addonDesc")
  });

  /**
   * 'addon list' command.
   */
  this.items.push({
    name: "addon list",
    description: gcli.lookup("addonListDesc"),
    returnType: "addonsInfo",
    params: [{
      name: 'type',
      type: {
        name: 'selection',
        data: ["dictionary", "extension", "locale", "plugin", "theme", "all"]
      },
      defaultValue: 'all',
      description: gcli.lookup("addonListTypeDesc")
    }],
    exec: function(aArgs, context) {
      let deferred = context.defer();
      function pendingOperations(aAddon) {
        let allOperations = ["PENDING_ENABLE",
                             "PENDING_DISABLE",
                             "PENDING_UNINSTALL",
                             "PENDING_INSTALL",
                             "PENDING_UPGRADE"];
        return allOperations.reduce(function(operations, opName) {
          return aAddon.pendingOperations & AddonManager[opName] ?
            operations.concat(opName) :
            operations;
        }, []);
      }
      let types = aArgs.type === "all" ? null : [aArgs.type];
      AddonManager.getAddonsByTypes(types, function(addons) {
        deferred.resolve({
          addons: addons.map(function(addon) {
            return {
              name: addon.name,
              version: addon.version,
              isActive: addon.isActive,
              pendingOperations: pendingOperations(addon)
            };
          }),
          type: aArgs.type
        });
      });
      return deferred.promise;
    }
  });

  this.items.push({
    item: "converter",
    from: "addonsInfo",
    to: "view",
    exec: function(addonsInfo, context) {
      if (!addonsInfo.addons.length) {
        return context.createView({
          html: "<p>${message}</p>",
          data: { message: gcli.lookup("addonNoneOfType") }
        });
      }

      let headerLookups = {
        "dictionary": "addonListDictionaryHeading",
        "extension": "addonListExtensionHeading",
        "locale": "addonListLocaleHeading",
        "plugin": "addonListPluginHeading",
        "theme": "addonListThemeHeading",
        "all": "addonListAllHeading"
      };
      let header = gcli.lookup(headerLookups[addonsInfo.type] ||
                               "addonListUnknownHeading");

      let operationLookups = {
        "PENDING_ENABLE": "addonPendingEnable",
        "PENDING_DISABLE": "addonPendingDisable",
        "PENDING_UNINSTALL": "addonPendingUninstall",
        "PENDING_INSTALL": "addonPendingInstall",
        "PENDING_UPGRADE": "addonPendingUpgrade"
      };
      function lookupOperation(opName) {
        let lookupName = operationLookups[opName];
        return lookupName ? gcli.lookup(lookupName) : opName;
      }

      function arrangeAddons(addons) {
        let enabledAddons = [];
        let disabledAddons = [];
        addons.forEach(function(aAddon) {
          if (aAddon.isActive) {
            enabledAddons.push(aAddon);
          } else {
            disabledAddons.push(aAddon);
          }
        });

        function compareAddonNames(aNameA, aNameB) {
          return String.localeCompare(aNameA.name, aNameB.name);
        }
        enabledAddons.sort(compareAddonNames);
        disabledAddons.sort(compareAddonNames);

        return enabledAddons.concat(disabledAddons);
      }

      function isActiveForToggle(addon) {
        return (addon.isActive && ~~addon.pendingOperations.indexOf("PENDING_DISABLE"));
      }

      return context.createView({
        html: addonsListHtml,
        data: {
          header: header,
          addons: arrangeAddons(addonsInfo.addons).map(function(addon) {
            return {
              name: addon.name,
              label: addon.name.replace(/\s/g, "_") +
                    (addon.version ? "_" + addon.version : ""),
              status: addon.isActive ? "enabled" : "disabled",
              version: addon.version,
              pendingOperations: addon.pendingOperations.length ?
                (" (" + gcli.lookup("addonPending") + ": "
                 + addon.pendingOperations.map(lookupOperation).join(", ")
                 + ")") :
                "",
              toggleActionName: isActiveForToggle(addon) ? "disable": "enable",
              toggleActionMessage: isActiveForToggle(addon) ?
                gcli.lookup("addonListOutDisable") :
                gcli.lookup("addonListOutEnable")
            };
          }),
          onclick: context.update,
          ondblclick: context.updateExec
        }
      });
    }
  });

  var addonsListHtml = "" +
        "<table>" +
        " <caption>${header}</caption>" +
        " <tbody>" +
        "  <tr foreach='addon in ${addons}'" +
        "      class=\"gcli-addon-${addon.status}\">" +
        "    <td>${addon.name} ${addon.version}</td>" +
        "    <td>${addon.pendingOperations}</td>" +
        "    <td>" +
        "      <span class='gcli-out-shortcut'" +
        "            data-command='addon ${addon.toggleActionName} ${addon.label}'" +
        "       onclick='${onclick}'" +
        "       ondblclick='${ondblclick}'" +
        "      >${addon.toggleActionMessage}</span>" +
        "    </td>" +
        "  </tr>" +
        " </tbody>" +
        "</table>" +
        "";

  // We need a list of addon names for the enable and disable commands. Because
  // getting the name list is async we do not add the commands until we have the
  // list.
  AddonManager.getAllAddons(function addonAsync(aAddons) {
    // We listen for installs to keep our addon list up to date. There is no need
    // to listen for uninstalls because uninstalled addons are simply disabled
    // until restart (to enable undo functionality).
    AddonManager.addAddonListener({
      onInstalled: function(aAddon) {
        addonNameCache.push({
          name: representAddon(aAddon).replace(/\s/g, "_"),
          value: aAddon.name
        });
      },
      onUninstalled: function(aAddon) {
        let name = representAddon(aAddon).replace(/\s/g, "_");

        for (let i = 0; i < addonNameCache.length; i++) {
          if(addonNameCache[i].name == name) {
            addonNameCache.splice(i, 1);
            break;
          }
        }
      },
    });

    /**
    * Returns a string that represents the passed add-on.
    */
    function representAddon(aAddon) {
      let name = aAddon.name + " " + aAddon.version;
      return name.trim();
    }

    let addonNameCache = [];

    // The name parameter, used in "addon enable" and "addon disable."
    let nameParameter = {
      name: "name",
      type: {
        name: "selection",
        lookup: addonNameCache
      },
      description: gcli.lookup("addonNameDesc")
    };

    for (let addon of aAddons) {
      addonNameCache.push({
        name: representAddon(addon).replace(/\s/g, "_"),
        value: addon.name
      });
    }

    /**
    * 'addon enable' command.
    */
    this.items.push({
      name: "addon enable",
      description: gcli.lookup("addonEnableDesc"),
      params: [nameParameter],
      exec: function(aArgs, context) {
        /**
         * Enables the addon in the passed list which has a name that matches
         * according to the passed name comparer, and resolves the promise which
         * is the scope (this) of this function to display the result of this
         * enable attempt.
         */
        function enable(aName, addons) {
          // Find the add-on.
          let addon = null;
          addons.some(function(candidate) {
            if (candidate.name == aName) {
              addon = candidate;
              return true;
            } else {
              return false;
            }
          });

          let name = representAddon(addon);
          let message = "";

          if (!addon.userDisabled) {
            message = gcli.lookupFormat("addonAlreadyEnabled", [name]);
          } else {
            addon.userDisabled = false;
            message = gcli.lookupFormat("addonEnabled", [name]);
          }
          this.resolve(message);
        }

        let deferred = context.defer();
        // List the installed add-ons, enable one when done listing.
        AddonManager.getAllAddons(enable.bind(deferred, aArgs.name));
        return deferred.promise;
      }
    });

    /**
     * 'addon disable' command.
     */
    this.items.push({
      name: "addon disable",
      description: gcli.lookup("addonDisableDesc"),
      params: [nameParameter],
      exec: function(aArgs, context) {
        /**
        * Like enable, but ... you know ... the exact opposite.
        */
        function disable(aName, addons) {
          // Find the add-on.
          let addon = null;
          addons.some(function(candidate) {
            if (candidate.name == aName) {
              addon = candidate;
              return true;
            } else {
              return false;
            }
          });

          let name = representAddon(addon);
          let message = "";

          // If the addon is not disabled or is set to "click to play" then
          // disable it. Otherwise display the message "Add-on is already
          // disabled."
          if (!addon.userDisabled ||
              addon.userDisabled === AddonManager.STATE_ASK_TO_ACTIVATE) {
            addon.userDisabled = true;
            message = gcli.lookupFormat("addonDisabled", [name]);
          } else {
            message = gcli.lookupFormat("addonAlreadyDisabled", [name]);
          }
          this.resolve(message);
        }

        let deferred = context.defer();
        // List the installed add-ons, disable one when done listing.
        AddonManager.getAllAddons(disable.bind(deferred, aArgs.name));
        return deferred.promise;
      }
    });
    module.CmdAddonFlags.addonsLoaded = true;
    Services.obs.notifyObservers(null, "gcli_addon_commands_ready", null);
  });

}(this));

/* CmdCalllog -------------------------------------------------------------- */

(function(module) {
  XPCOMUtils.defineLazyGetter(this, "Debugger", function() {
    let JsDebugger = {};
    Components.utils.import("resource://gre/modules/jsdebugger.jsm", JsDebugger);

    let global = Components.utils.getGlobalForObject({});
    JsDebugger.addDebuggerToGlobal(global);

    return global.Debugger;
  });

  let debuggers = [];

  /**
   * 'calllog' command
   */
  this.items.push({
    name: "calllog",
    description: gcli.lookup("calllogDesc")
  })

  /**
   * 'calllog start' command
   */
  this.items.push({
    name: "calllog start",
    description: gcli.lookup("calllogStartDesc"),

    exec: function(args, context) {
      let contentWindow = context.environment.window;

      let dbg = new Debugger(contentWindow);
      dbg.onEnterFrame = function(frame) {
        // BUG 773652 -  Make the output from the GCLI calllog command nicer
        contentWindow.console.log("Method call: " + this.callDescription(frame));
      }.bind(this);

      debuggers.push(dbg);

      let gBrowser = context.environment.chromeDocument.defaultView.gBrowser;
      let target = devtools.TargetFactory.forTab(gBrowser.selectedTab);
      gDevTools.showToolbox(target, "webconsole");

      return gcli.lookup("calllogStartReply");
    },

    callDescription: function(frame) {
      let name = "<anonymous>";
      if (frame.callee.name) {
        name = frame.callee.name;
      }
      else {
        let desc = frame.callee.getOwnPropertyDescriptor("displayName");
        if (desc && desc.value && typeof desc.value == "string") {
          name = desc.value;
        }
      }

      let args = frame.arguments.map(this.valueToString).join(", ");
      return name + "(" + args + ")";
    },

    valueToString: function(value) {
      if (typeof value !== "object" || value === null) {
        return uneval(value);
      }
      return "[object " + value.class + "]";
    }
  });

  /**
   * 'calllog stop' command
   */
  this.items.push({
    name: "calllog stop",
    description: gcli.lookup("calllogStopDesc"),

    exec: function(args, context) {
      let numDebuggers = debuggers.length;
      if (numDebuggers == 0) {
        return gcli.lookup("calllogStopNoLogging");
      }

      for (let dbg of debuggers) {
        dbg.onEnterFrame = undefined;
      }
      debuggers = [];

      return gcli.lookupFormat("calllogStopReply", [ numDebuggers ]);
    }
  });
}(this));

/* CmdCalllogChrome -------------------------------------------------------- */

(function(module) {
  XPCOMUtils.defineLazyGetter(this, "Debugger", function() {
    let JsDebugger = {};
    Cu.import("resource://gre/modules/jsdebugger.jsm", JsDebugger);

    let global = Components.utils.getGlobalForObject({});
    JsDebugger.addDebuggerToGlobal(global);

    return global.Debugger;
  });

  let debuggers = [];
  let sandboxes = [];

  /**
   * 'calllog chromestart' command
   */
  this.items.push({
    name: "calllog chromestart",
    description: gcli.lookup("calllogChromeStartDesc"),
    get hidden() gcli.hiddenByChromePref(),
    params: [
      {
        name: "sourceType",
        type: {
          name: "selection",
          data: ["content-variable", "chrome-variable", "jsm", "javascript"]
        }
      },
      {
        name: "source",
        type: "string",
        description: gcli.lookup("calllogChromeSourceTypeDesc"),
        manual: gcli.lookup("calllogChromeSourceTypeManual"),
      }
    ],
    exec: function(args, context) {
      let globalObj;
      let contentWindow = context.environment.window;

      if (args.sourceType == "jsm") {
        try {
          globalObj = Cu.import(args.source);
        }
        catch (e) {
          return gcli.lookup("callLogChromeInvalidJSM");
        }
      } else if (args.sourceType == "content-variable") {
        if (args.source in contentWindow) {
          globalObj = Cu.getGlobalForObject(contentWindow[args.source]);
        } else {
          throw new Error(gcli.lookup("callLogChromeVarNotFoundContent"));
        }
      } else if (args.sourceType == "chrome-variable") {
        let chromeWin = context.environment.chromeDocument.defaultView;
        if (args.source in chromeWin) {
          globalObj = Cu.getGlobalForObject(chromeWin[args.source]);
        } else {
          return gcli.lookup("callLogChromeVarNotFoundChrome");
        }
      } else {
        let chromeWin = context.environment.chromeDocument.defaultView;
        let sandbox = new Cu.Sandbox(chromeWin,
                                    {
                                      sandboxPrototype: chromeWin,
                                      wantXrays: false,
                                      sandboxName: "gcli-cmd-calllog-chrome"
                                    });
        let returnVal;
        try {
          returnVal = Cu.evalInSandbox(args.source, sandbox, "ECMAv5");
          sandboxes.push(sandbox);
        } catch(e) {
          // We need to save the message before cleaning up else e contains a dead
          // object.
          let msg = gcli.lookup("callLogChromeEvalException") + ": " + e;
          Cu.nukeSandbox(sandbox);
          return msg;
        }

        if (typeof returnVal == "undefined") {
          return gcli.lookup("callLogChromeEvalNeedsObject");
        }

        globalObj = Cu.getGlobalForObject(returnVal);
      }

      let dbg = new Debugger(globalObj);
      debuggers.push(dbg);

      dbg.onEnterFrame = function(frame) {
        // BUG 773652 -  Make the output from the GCLI calllog command nicer
        contentWindow.console.log(gcli.lookup("callLogChromeMethodCall") +
                                  ": " + this.callDescription(frame));
      }.bind(this);

      let gBrowser = context.environment.chromeDocument.defaultView.gBrowser;
      let target = devtools.TargetFactory.forTab(gBrowser.selectedTab);
      gDevTools.showToolbox(target, "webconsole");

      return gcli.lookup("calllogChromeStartReply");
    },

    valueToString: function(value) {
      if (typeof value !== "object" || value === null)
        return uneval(value);
      return "[object " + value.class + "]";
    },

    callDescription: function(frame) {
      let name = frame.callee.name || gcli.lookup("callLogChromeAnonFunction");
      let args = frame.arguments.map(this.valueToString).join(", ");
      return name + "(" + args + ")";
    }
  });

  /**
   * 'calllog chromestop' command
   */
  this.items.push({
    name: "calllog chromestop",
    description: gcli.lookup("calllogChromeStopDesc"),
    get hidden() gcli.hiddenByChromePref(),
    exec: function(args, context) {
      let numDebuggers = debuggers.length;
      if (numDebuggers == 0) {
        return gcli.lookup("calllogChromeStopNoLogging");
      }

      for (let dbg of debuggers) {
        dbg.onEnterFrame = undefined;
        dbg.enabled = false;
      }
      for (let sandbox of sandboxes) {
        Cu.nukeSandbox(sandbox);
      }
      debuggers = [];
      sandboxes = [];

      return gcli.lookupFormat("calllogChromeStopReply", [ numDebuggers ]);
    }
  });
}(this));

