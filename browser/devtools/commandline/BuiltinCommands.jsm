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

/* CmdCmd ------------------------------------------------------------------ */

(function(module) {
  let prefSvc = "@mozilla.org/preferences-service;1";
  XPCOMUtils.defineLazyGetter(this, "prefBranch", function() {
    let prefService = Cc[prefSvc].getService(Ci.nsIPrefService);
    return prefService.getBranch(null).QueryInterface(Ci.nsIPrefBranch2);
  });

  XPCOMUtils.defineLazyGetter(this, 'supportsString', function() {
    return Cc["@mozilla.org/supports-string;1"]
             .createInstance(Ci.nsISupportsString);
  });

  XPCOMUtils.defineLazyModuleGetter(this, "NetUtil",
                                    "resource://gre/modules/NetUtil.jsm");
  XPCOMUtils.defineLazyModuleGetter(this, "console",
                                    "resource://gre/modules/devtools/Console.jsm");

  const PREF_DIR = "devtools.commands.dir";

  /**
   * Load all the .mozcmd files in the directory pointed to by PREF_DIR
   * @return A promise of an array of items suitable for gcli.addItems or
   * using in gcli.addItemsByModule
   */
  function loadItemsFromMozDir() {
    let dirName = prefBranch.getComplexValue(PREF_DIR,
                                             Ci.nsISupportsString).data.trim();
    if (dirName == "") {
      return promise.resolve([]);
    }

    // replaces ~ with the home directory path in unix and windows
    if (dirName.indexOf("~") == 0) {
      let dirService = Cc["@mozilla.org/file/directory_service;1"]
                        .getService(Ci.nsIProperties);
      let homeDirFile = dirService.get("Home", Ci.nsIFile);
      let homeDir = homeDirFile.path;
      dirName = dirName.substr(1);
      dirName = homeDir + dirName;
    }

    // statPromise resolves to nothing if dirName is a directory, or it
    // rejects with an error message otherwise
    let statPromise = OS.File.stat(dirName);
    statPromise = statPromise.then(
      function onSuccess(stat) {
        if (!stat.isDir) {
          throw new Error('\'' + dirName + '\' is not a directory.');
        }
      },
      function onFailure(reason) {
        if (reason instanceof OS.File.Error && reason.becauseNoSuchFile) {
          throw new Error('\'' + dirName + '\' does not exist.');
        } else {
          throw reason;
        }
      }
    );

    // We need to return (a promise of) an array of items from the *.mozcmd
    // files in dirName (which we can assume to be a valid directory now)
    return statPromise.then(() => {
      let itemPromises = [];

      let iterator = new OS.File.DirectoryIterator(dirName);
      let iterPromise = iterator.forEach(entry => {
        if (entry.name.match(/.*\.mozcmd$/) && !entry.isDir) {
          itemPromises.push(loadCommandFile(entry));
        }
      });

      return iterPromise.then(() => {
        iterator.close();
        return promise.all(itemPromises).then((itemsArray) => {
          return itemsArray.reduce((prev, curr) => {
            return prev.concat(curr);
          }, []);
        });
      }, reason => { iterator.close(); throw reason; });
    });
  }

  this.mozDirLoader = function(name) {
    return loadItemsFromMozDir().then(items => {
      return { items: items };
    });
  };

  /**
   * Load the commands from a single file
   * @param OS.File.DirectoryIterator.Entry entry The DirectoryIterator
   * Entry of the file containing the commands that we should read
   */
  function loadCommandFile(entry) {
    let readPromise = OS.File.read(entry.path);
    return readPromise = readPromise.then(array => {
      let decoder = new TextDecoder();
      let source = decoder.decode(array);
      var principal = Cc["@mozilla.org/systemprincipal;1"]
                        .createInstance(Ci.nsIPrincipal);

      let sandbox = new Cu.Sandbox(principal, {
        sandboxName: entry.path
      });
      let data = Cu.evalInSandbox(source, sandbox, "1.8", entry.name, 1);

      if (!Array.isArray(data)) {
        console.error("Command file '" + entry.name + "' does not have top level array.");
        return;
      }

      return data;
    });
  }

  /**
   * 'cmd' command
   */
  this.items.push({
    name: "cmd",
    get hidden() {
      return !prefBranch.prefHasUserValue(PREF_DIR);
    },
    description: gcli.lookup("cmdDesc")
  });

  /**
   * 'cmd refresh' command
   */
  this.items.push({
    name: "cmd refresh",
    description: gcli.lookup("cmdRefreshDesc"),
    get hidden() {
      return !prefBranch.prefHasUserValue(PREF_DIR);
    },
    exec: function(args, context) {
      gcli.load();

      let dirName = prefBranch.getComplexValue(PREF_DIR,
                                              Ci.nsISupportsString).data.trim();
      return gcli.lookupFormat("cmdStatus2", [ dirName ]);
    }
  });

  /**
   * 'cmd setdir' command
   */
  this.items.push({
    name: "cmd setdir",
    description: gcli.lookup("cmdSetdirDesc"),
    params: [
      {
        name: "directory",
        description: gcli.lookup("cmdSetdirDirectoryDesc"),
        type: {
          name: "file",
          filetype: "directory",
          existing: "yes"
        },
        defaultValue: null
      }
    ],
    returnType: "string",
    get hidden() {
      return true; // !prefBranch.prefHasUserValue(PREF_DIR);
    },
    exec: function(args, context) {
      supportsString.data = args.directory;
      prefBranch.setComplexValue(PREF_DIR, Ci.nsISupportsString, supportsString);

      gcli.load();

      return gcli.lookupFormat("cmdStatus2", [ args.directory ]);
    }
  });
}(this));

/* CmdConsole -------------------------------------------------------------- */

(function(module) {
  Object.defineProperty(this, "HUDService", {
    get: function() {
      return devtools.require("devtools/webconsole/hudservice");
    },
    configurable: true,
    enumerable: true
  });

  /**
   * 'console' command
   */
  this.items.push({
    name: "console",
    description: gcli.lookup("consoleDesc"),
    manual: gcli.lookup("consoleManual")
  });

  /**
   * 'console clear' command
   */
  this.items.push({
    name: "console clear",
    description: gcli.lookup("consoleclearDesc"),
    exec: function Command_consoleClear(args, context) {
      let hud = HUDService.getHudByWindow(context.environment.window);
      // hud will be null if the web console has not been opened for this window
      if (hud) {
        hud.jsterm.clearOutput();
      }
    }
  });

  /**
   * 'console close' command
   */
  this.items.push({
    name: "console close",
    description: gcli.lookup("consolecloseDesc"),
    exec: function(args, context) {
      return gDevTools.closeToolbox(context.environment.target);
    }
  });

  /**
   * 'console open' command
   */
  this.items.push({
    name: "console open",
    description: gcli.lookup("consoleopenDesc"),
    exec: function(args, context) {
      return gDevTools.showToolbox(context.environment.target, "webconsole");
    }
  });
}(this));

/* CmdCookie --------------------------------------------------------------- */

(function(module) {
  XPCOMUtils.defineLazyModuleGetter(this, "console",
                                    "resource://gre/modules/devtools/Console.jsm");

  const cookieMgr = Cc["@mozilla.org/cookiemanager;1"]
                      .getService(Ci.nsICookieManager2);

  /**
   * The template for the 'cookie list' command.
   */
  let cookieListHtml = "" +
    "<ul class='gcli-cookielist-list'>" +
    "  <li foreach='cookie in ${cookies}'>" +
    "    <div>${cookie.name}=${cookie.value}</div>" +
    "    <table class='gcli-cookielist-detail'>" +
    "      <tr>" +
    "        <td>" + gcli.lookup("cookieListOutHost") + "</td>" +
    "        <td>${cookie.host}</td>" +
    "      </tr>" +
    "      <tr>" +
    "        <td>" + gcli.lookup("cookieListOutPath") + "</td>" +
    "        <td>${cookie.path}</td>" +
    "      </tr>" +
    "      <tr>" +
    "        <td>" + gcli.lookup("cookieListOutExpires") + "</td>" +
    "        <td>${cookie.expires}</td>" +
    "      </tr>" +
    "      <tr>" +
    "        <td>" + gcli.lookup("cookieListOutAttributes") + "</td>" +
    "        <td>${cookie.attrs}</td>" +
    "      </tr>" +
    "      <tr><td colspan='2'>" +
    "        <span class='gcli-out-shortcut' onclick='${onclick}'" +
    "            data-command='cookie set ${cookie.name} '" +
    "            >" + gcli.lookup("cookieListOutEdit") + "</span>" +
    "        <span class='gcli-out-shortcut'" +
    "            onclick='${onclick}' ondblclick='${ondblclick}'" +
    "            data-command='cookie remove ${cookie.name}'" +
    "            >" + gcli.lookup("cookieListOutRemove") + "</span>" +
    "      </td></tr>" +
    "    </table>" +
    "  </li>" +
    "</ul>" +
    "";

  this.items.push({
    item: "converter",
    from: "cookies",
    to: "view",
    exec: function(cookies, context) {
      if (cookies.length == 0) {
        let host = context.environment.document.location.host;
        let msg = gcli.lookupFormat("cookieListOutNoneHost", [ host ]);
        return context.createView({ html: "<span>" + msg + "</span>" });
      }

      for (let cookie of cookies) {
        cookie.expires = translateExpires(cookie.expires);

        let noAttrs = !cookie.secure && !cookie.httpOnly && !cookie.sameDomain;
        cookie.attrs = (cookie.secure ? 'secure' : ' ') +
                       (cookie.httpOnly ? 'httpOnly' : ' ') +
                       (cookie.sameDomain ? 'sameDomain' : ' ') +
                       (noAttrs ? gcli.lookup("cookieListOutNone") : ' ');
      }

      return context.createView({
        html: cookieListHtml,
        data: {
          options: { allowEval: true },
          cookies: cookies,
          onclick: context.update,
          ondblclick: context.updateExec
        }
      });
    }
  });

  /**
   * The cookie 'expires' value needs converting into something more readable
   */
  function translateExpires(expires) {
    if (expires == 0) {
      return gcli.lookup("cookieListOutSession");
    }
    return new Date(expires).toLocaleString();
  }

  /**
   * Check if a given cookie matches a given host
   */
  function isCookieAtHost(cookie, host) {
    if (cookie.host == null) {
      return host == null;
    }
    if (cookie.host.startsWith(".")) {
      return host.endsWith(cookie.host);
    }
    else {
      return cookie.host == host;
    }
  }

  /**
   * 'cookie' command
   */
  this.items.push({
    name: "cookie",
    description: gcli.lookup("cookieDesc"),
    manual: gcli.lookup("cookieManual")
  });

  /**
   * 'cookie list' command
   */
  this.items.push({
    name: "cookie list",
    description: gcli.lookup("cookieListDesc"),
    manual: gcli.lookup("cookieListManual"),
    returnType: "cookies",
    exec: function(args, context) {
      let host = context.environment.document.location.host;
      if (host == null || host == "") {
        throw new Error(gcli.lookup("cookieListOutNonePage"));
      }

      let enm = cookieMgr.getCookiesFromHost(host);

      let cookies = [];
      while (enm.hasMoreElements()) {
        let cookie = enm.getNext().QueryInterface(Ci.nsICookie);
        if (isCookieAtHost(cookie, host)) {
          cookies.push({
            host: cookie.host,
            name: cookie.name,
            value: cookie.value,
            path: cookie.path,
            expires: cookie.expires,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameDomain: cookie.sameDomain
          });
        }
      }

      return cookies;
    }
  });

  /**
   * 'cookie remove' command
   */
  this.items.push({
    name: "cookie remove",
    description: gcli.lookup("cookieRemoveDesc"),
    manual: gcli.lookup("cookieRemoveManual"),
    params: [
      {
        name: "name",
        type: "string",
        description: gcli.lookup("cookieRemoveKeyDesc"),
      }
    ],
    exec: function(args, context) {
      let host = context.environment.document.location.host;
      let enm = cookieMgr.getCookiesFromHost(host);

      let cookies = [];
      while (enm.hasMoreElements()) {
        let cookie = enm.getNext().QueryInterface(Ci.nsICookie);
        if (isCookieAtHost(cookie, host)) {
          if (cookie.name == args.name) {
            cookieMgr.remove(cookie.host, cookie.name, cookie.path, false);
          }
        }
      }
    }
  });

  /**
   * 'cookie set' command
   */
  this.items.push({
    name: "cookie set",
    description: gcli.lookup("cookieSetDesc"),
    manual: gcli.lookup("cookieSetManual"),
    params: [
      {
        name: "name",
        type: "string",
        description: gcli.lookup("cookieSetKeyDesc")
      },
      {
        name: "value",
        type: "string",
        description: gcli.lookup("cookieSetValueDesc")
      },
      {
        group: gcli.lookup("cookieSetOptionsDesc"),
        params: [
          {
            name: "path",
            type: { name: "string", allowBlank: true },
            defaultValue: "/",
            description: gcli.lookup("cookieSetPathDesc")
          },
          {
            name: "domain",
            type: "string",
            defaultValue: null,
            description: gcli.lookup("cookieSetDomainDesc")
          },
          {
            name: "secure",
            type: "boolean",
            description: gcli.lookup("cookieSetSecureDesc")
          },
          {
            name: "httpOnly",
            type: "boolean",
            description: gcli.lookup("cookieSetHttpOnlyDesc")
          },
          {
            name: "session",
            type: "boolean",
            description: gcli.lookup("cookieSetSessionDesc")
          },
          {
            name: "expires",
            type: "string",
            defaultValue: "Jan 17, 2038",
            description: gcli.lookup("cookieSetExpiresDesc")
          },
        ]
      }
    ],
    exec: function(args, context) {
      let host = context.environment.document.location.host;
      let time = Date.parse(args.expires) / 1000;

      cookieMgr.add(args.domain ? "." + args.domain : host,
                    args.path ? args.path : "/",
                    args.name,
                    args.value,
                    args.secure,
                    args.httpOnly,
                    args.session,
                    time);
    }
  });
}(this));

/* CmdExport --------------------------------------------------------------- */

(function(module) {
  /**
   * 'export' command
   */
  this.items.push({
    name: "export",
    description: gcli.lookup("exportDesc"),
  });

  /**
   * The 'export html' command. This command allows the user to export the page to
   * HTML after they do DOM changes.
   */
  this.items.push({
    name: "export html",
    description: gcli.lookup("exportHtmlDesc"),
    exec: function(args, context) {
      let html = context.environment.document.documentElement.outerHTML;
      let url = 'data:text/plain;charset=utf8,' + encodeURIComponent(html);
      context.environment.window.open(url);
    }
  });
}(this));

/* CmdJsb ------------------------------------------------------------------ */

(function(module) {
  const XMLHttpRequest =
    Components.Constructor("@mozilla.org/xmlextras/xmlhttprequest;1");

  XPCOMUtils.defineLazyModuleGetter(this, "js_beautify",
                                    "resource:///modules/devtools/Jsbeautify.jsm");

  /**
   * jsb command.
   */
  this.items.push({
    name: 'jsb',
    description: gcli.lookup('jsbDesc'),
    returnValue:'string',
    params: [
      {
        name: 'url',
        type: 'string',
        description: gcli.lookup('jsbUrlDesc')
      },
      {
        group: gcli.lookup("jsbOptionsDesc"),
        params: [
          {
            name: 'indentSize',
            type: 'number',
            description: gcli.lookup('jsbIndentSizeDesc'),
            manual: gcli.lookup('jsbIndentSizeManual'),
            defaultValue: 2
          },
          {
            name: 'indentChar',
            type: {
              name: 'selection',
              lookup: [
                { name: "space", value: " " },
                { name: "tab", value: "\t" }
              ]
            },
            description: gcli.lookup('jsbIndentCharDesc'),
            manual: gcli.lookup('jsbIndentCharManual'),
            defaultValue: ' ',
          },
          {
            name: 'doNotPreserveNewlines',
            type: 'boolean',
            description: gcli.lookup('jsbDoNotPreserveNewlinesDesc')
          },
          {
            name: 'preserveMaxNewlines',
            type: 'number',
            description: gcli.lookup('jsbPreserveMaxNewlinesDesc'),
            manual: gcli.lookup('jsbPreserveMaxNewlinesManual'),
            defaultValue: -1
          },
          {
            name: 'jslintHappy',
            type: 'boolean',
            description: gcli.lookup('jsbJslintHappyDesc'),
            manual: gcli.lookup('jsbJslintHappyManual')
          },
          {
            name: 'braceStyle',
            type: {
              name: 'selection',
              data: ['collapse', 'expand', 'end-expand', 'expand-strict']
            },
            description: gcli.lookup('jsbBraceStyleDesc2'),
            manual: gcli.lookup('jsbBraceStyleManual2'),
            defaultValue: "collapse"
          },
          {
            name: 'noSpaceBeforeConditional',
            type: 'boolean',
            description: gcli.lookup('jsbNoSpaceBeforeConditionalDesc')
          },
          {
            name: 'unescapeStrings',
            type: 'boolean',
            description: gcli.lookup('jsbUnescapeStringsDesc'),
            manual: gcli.lookup('jsbUnescapeStringsManual')
          }
        ]
      }
    ],
    exec: function(args, context) {
      let opts = {
        indent_size: args.indentSize,
        indent_char: args.indentChar,
        preserve_newlines: !args.doNotPreserveNewlines,
        max_preserve_newlines: args.preserveMaxNewlines == -1 ?
                              undefined : args.preserveMaxNewlines,
        jslint_happy: args.jslintHappy,
        brace_style: args.braceStyle,
        space_before_conditional: !args.noSpaceBeforeConditional,
        unescape_strings: args.unescapeStrings
      };

      let xhr = new XMLHttpRequest();

      try {
        xhr.open("GET", args.url, true);
      } catch(e) {
        return gcli.lookup('jsbInvalidURL');
      }

      let deferred = context.defer();

      xhr.onreadystatechange = function(aEvt) {
        if (xhr.readyState == 4) {
          if (xhr.status == 200 || xhr.status == 0) {
            let browserDoc = context.environment.chromeDocument;
            let browserWindow = browserDoc.defaultView;
            let gBrowser = browserWindow.gBrowser;
            let result = js_beautify(xhr.responseText, opts);

            browserWindow.Scratchpad.ScratchpadManager.openScratchpad({text: result});

            deferred.resolve();
          } else {
            deferred.resolve("Unable to load page to beautify: " + args.url + " " +
                             xhr.status + " " + xhr.statusText);
          }
        };
      }
      xhr.send(null);
      return deferred.promise;
    }
  });
}(this));

/* CmdPagemod -------------------------------------------------------------- */

(function(module) {
  /**
   * 'pagemod' command
   */
  this.items.push({
    name: "pagemod",
    description: gcli.lookup("pagemodDesc"),
  });

  /**
   * The 'pagemod replace' command. This command allows the user to search and
   * replace within text nodes and attributes.
   */
  this.items.push({
    name: "pagemod replace",
    description: gcli.lookup("pagemodReplaceDesc"),
    params: [
      {
        name: "search",
        type: "string",
        description: gcli.lookup("pagemodReplaceSearchDesc"),
      },
      {
        name: "replace",
        type: "string",
        description: gcli.lookup("pagemodReplaceReplaceDesc"),
      },
      {
        name: "ignoreCase",
        type: "boolean",
        description: gcli.lookup("pagemodReplaceIgnoreCaseDesc"),
      },
      {
        name: "selector",
        type: "string",
        description: gcli.lookup("pagemodReplaceSelectorDesc"),
        defaultValue: "*:not(script):not(style):not(embed):not(object):not(frame):not(iframe):not(frameset)",
      },
      {
        name: "root",
        type: "node",
        description: gcli.lookup("pagemodReplaceRootDesc"),
        defaultValue: null,
      },
      {
        name: "attrOnly",
        type: "boolean",
        description: gcli.lookup("pagemodReplaceAttrOnlyDesc"),
      },
      {
        name: "contentOnly",
        type: "boolean",
        description: gcli.lookup("pagemodReplaceContentOnlyDesc"),
      },
      {
        name: "attributes",
        type: "string",
        description: gcli.lookup("pagemodReplaceAttributesDesc"),
        defaultValue: null,
      },
    ],
    exec: function(args, context) {
      let searchTextNodes = !args.attrOnly;
      let searchAttributes = !args.contentOnly;
      let regexOptions = args.ignoreCase ? 'ig' : 'g';
      let search = new RegExp(escapeRegex(args.search), regexOptions);
      let attributeRegex = null;
      if (args.attributes) {
        attributeRegex = new RegExp(args.attributes, regexOptions);
      }

      let root = args.root || context.environment.document;
      let elements = root.querySelectorAll(args.selector);
      elements = Array.prototype.slice.call(elements);

      let replacedTextNodes = 0;
      let replacedAttributes = 0;

      function replaceAttribute() {
        replacedAttributes++;
        return args.replace;
      }
      function replaceTextNode() {
        replacedTextNodes++;
        return args.replace;
      }

      for (let i = 0; i < elements.length; i++) {
        let element = elements[i];
        if (searchTextNodes) {
          for (let y = 0; y < element.childNodes.length; y++) {
            let node = element.childNodes[y];
            if (node.nodeType == node.TEXT_NODE) {
              node.textContent = node.textContent.replace(search, replaceTextNode);
            }
          }
        }

        if (searchAttributes) {
          if (!element.attributes) {
            continue;
          }
          for (let y = 0; y < element.attributes.length; y++) {
            let attr = element.attributes[y];
            if (!attributeRegex || attributeRegex.test(attr.name)) {
              attr.value = attr.value.replace(search, replaceAttribute);
            }
          }
        }
      }

      return gcli.lookupFormat("pagemodReplaceResult",
                              [elements.length, replacedTextNodes,
                                replacedAttributes]);
    }
  });

  /**
   * 'pagemod remove' command
   */
  this.items.push({
    name: "pagemod remove",
    description: gcli.lookup("pagemodRemoveDesc"),
  });


  /**
   * The 'pagemod remove element' command.
   */
  this.items.push({
    name: "pagemod remove element",
    description: gcli.lookup("pagemodRemoveElementDesc"),
    params: [
      {
        name: "search",
        type: "string",
        description: gcli.lookup("pagemodRemoveElementSearchDesc"),
      },
      {
        name: "root",
        type: "node",
        description: gcli.lookup("pagemodRemoveElementRootDesc"),
        defaultValue: null,
      },
      {
        name: 'stripOnly',
        type: 'boolean',
        description: gcli.lookup("pagemodRemoveElementStripOnlyDesc"),
      },
      {
        name: 'ifEmptyOnly',
        type: 'boolean',
        description: gcli.lookup("pagemodRemoveElementIfEmptyOnlyDesc"),
      },
    ],
    exec: function(args, context) {
      let root = args.root || context.environment.document;
      let elements = Array.prototype.slice.call(root.querySelectorAll(args.search));

      let removed = 0;
      for (let i = 0; i < elements.length; i++) {
        let element = elements[i];
        let parentNode = element.parentNode;
        if (!parentNode || !element.removeChild) {
          continue;
        }
        if (args.stripOnly) {
          while (element.hasChildNodes()) {
            parentNode.insertBefore(element.childNodes[0], element);
          }
        }
        if (!args.ifEmptyOnly || !element.hasChildNodes()) {
          element.parentNode.removeChild(element);
          removed++;
        }
      }

      return gcli.lookupFormat("pagemodRemoveElementResultMatchedAndRemovedElements",
                              [elements.length, removed]);
    }
  });

  /**
   * The 'pagemod remove attribute' command.
   */
  this.items.push({
    name: "pagemod remove attribute",
    description: gcli.lookup("pagemodRemoveAttributeDesc"),
    params: [
      {
        name: "searchAttributes",
        type: "string",
        description: gcli.lookup("pagemodRemoveAttributeSearchAttributesDesc"),
      },
      {
        name: "searchElements",
        type: "string",
        description: gcli.lookup("pagemodRemoveAttributeSearchElementsDesc"),
      },
      {
        name: "root",
        type: "node",
        description: gcli.lookup("pagemodRemoveAttributeRootDesc"),
        defaultValue: null,
      },
      {
        name: "ignoreCase",
        type: "boolean",
        description: gcli.lookup("pagemodRemoveAttributeIgnoreCaseDesc"),
      },
    ],
    exec: function(args, context) {
      let root = args.root || context.environment.document;
      let regexOptions = args.ignoreCase ? 'ig' : 'g';
      let attributeRegex = new RegExp(args.searchAttributes, regexOptions);
      let elements = root.querySelectorAll(args.searchElements);
      elements = Array.prototype.slice.call(elements);

      let removed = 0;
      for (let i = 0; i < elements.length; i++) {
        let element = elements[i];
        if (!element.attributes) {
          continue;
        }

        var attrs = Array.prototype.slice.call(element.attributes);
        for (let y = 0; y < attrs.length; y++) {
          let attr = attrs[y];
          if (attributeRegex.test(attr.name)) {
            element.removeAttribute(attr.name);
            removed++;
          }
        }
      }

      return gcli.lookupFormat("pagemodRemoveAttributeResult",
                              [elements.length, removed]);
    }
  });

  /**
   * Make a given string safe to use  in a regular expression.
   *
   * @param string aString
   *        The string you want to use in a regex.
   * @return string
   *         The equivalent of |aString| but safe to use in a regex.
   */
  function escapeRegex(aString) {
    return aString.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
  }
}(this));

/* CmdTools -------------------------------------------------------------- */

(function(module) {
  this.items.push({
    name: "tools",
    description: gcli.lookupFormat("toolsDesc2", [BRAND_SHORT_NAME]),
    manual: gcli.lookupFormat("toolsManual2", [BRAND_SHORT_NAME]),
    get hidden() gcli.hiddenByChromePref(),
  });

  this.items.push({
    name: "tools srcdir",
    description: gcli.lookup("toolsSrcdirDesc"),
    manual: gcli.lookupFormat("toolsSrcdirManual2", [BRAND_SHORT_NAME]),
    get hidden() gcli.hiddenByChromePref(),
    params: [
      {
        name: "srcdir",
        type: "string" /* {
          name: "file",
          filetype: "directory",
          existing: "yes"
        } */,
        description: gcli.lookup("toolsSrcdirDir")
      }
    ],
    returnType: "string",
    exec: function(args, context) {
      let clobber = OS.Path.join(args.srcdir, "CLOBBER");
      return OS.File.exists(clobber).then(function(exists) {
        if (exists) {
          let str = Cc["@mozilla.org/supports-string;1"]
                    .createInstance(Ci.nsISupportsString);
          str.data = args.srcdir;
          Services.prefs.setComplexValue("devtools.loader.srcdir",
                                         Ci.nsISupportsString, str);
          devtools.reload();

          let msg = gcli.lookupFormat("toolsSrcdirReloaded", [args.srcdir]);
          throw new Error(msg);
        }

        return gcli.lookupFormat("toolsSrcdirNotFound", [args.srcdir]);
      });
    }
  });

  this.items.push({
    name: "tools builtin",
    description: gcli.lookup("toolsBuiltinDesc"),
    manual: gcli.lookup("toolsBuiltinManual"),
    get hidden() gcli.hiddenByChromePref(),
    returnType: "string",
    exec: function(args, context) {
      Services.prefs.clearUserPref("devtools.loader.srcdir");
      devtools.reload();
      return gcli.lookup("toolsBuiltinReloaded");
    }
  });

  this.items.push({
    name: "tools reload",
    description: gcli.lookup("toolsReloadDesc"),
    get hidden() gcli.hiddenByChromePref() || !Services.prefs.prefHasUserValue("devtools.loader.srcdir"),

    returnType: "string",
    exec: function(args, context) {
      devtools.reload();
      return gcli.lookup("toolsReloaded2");
    }
  });
}(this));
