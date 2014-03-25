/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;
const { Services } = require("resource://gre/modules/Services.jsm");
const { Promise: promise } = require("resource://gre/modules/commonjs/sdk/core/promise.js");
const gcli = require("gcli/index");

loader.lazyImporter(this, "AddonManager", "resource://gre/modules/AddonManager.jsm");

const BRAND_SHORT_NAME = Cc["@mozilla.org/intl/stringbundle;1"]
                           .getService(Ci.nsIStringBundleService)
                           .createBundle("chrome://branding/locale/brand.properties")
                           .GetStringFromName("brandShortName");

// When we've done the initial lookup of addons, we'll store them in addonCache,
// and keep them up to date with addon listeners. We use addonCacheDeferred to
// indicate when they're first ready
let addonCache = undefined;
let addonCacheDeferred = promise.defer();

/**
 * Returns a string that represents the passed add-on.
 */
function representAddon(addon) {
  let name = addon.name + " " + addon.version;
  return name.trim();
}

// We need a list of addon names for the enable and disable commands. Because
// getting the name list is async we do not add the commands until we have the
// list.
AddonManager.getAllAddons(function addonAsync(addons) {
  // We listen for installs to keep our addon list up to date. There is no need
  // to listen for uninstalls because uninstalled addons are simply disabled
  // until restart (to enable undo functionality).
  AddonManager.addAddonListener({
    onInstalled: function(addon) {
      addonCache.push({
        name: representAddon(addon).replace(/\s/g, "_"),
        value: addon.name
      });
    },
    onUninstalled: function(addon) {
      let name = representAddon(addon).replace(/\s/g, "_");

      for (let i = 0; i < addonCache.length; i++) {
        if(addonCache[i].name == name) {
          addonCache.splice(i, 1);
          break;
        }
      }
    },
  });

  let addonCache = [];

  for (let addon of addons) {
    addonCache.push({
      name: representAddon(addon).replace(/\s/g, "_"),
      value: addon.name
    });
  }
});

exports.items = [
  {
    item: 'type',
    name: 'addons',
    parent: 'selection',
    stringifyProperty: 'name',
    lookup: function() {
      return (addonCache != null) ? addonCache : addonCacheDeferred.promise;
    }
  },
  {
    name: "addon",
    description: gcli.lookup("addonDesc")
  },
  {
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
      function pendingOperations(addon) {
        let allOperations = ["PENDING_ENABLE",
                             "PENDING_DISABLE",
                             "PENDING_UNINSTALL",
                             "PENDING_INSTALL",
                             "PENDING_UPGRADE"];
        return allOperations.reduce(function(operations, opName) {
          return addon.pendingOperations & AddonManager[opName] ?
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
  },
  {
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
        addons.forEach(function(addon) {
          if (addon.isActive) {
            enabledAddons.push(addon);
          } else {
            disabledAddons.push(addon);
          }
        });

        function compareAddonNames(nameA, nameB) {
          return String.localeCompare(nameA.name, nameB.name);
        }
        enabledAddons.sort(compareAddonNames);
        disabledAddons.sort(compareAddonNames);

        return enabledAddons.concat(disabledAddons);
      }

      function isActiveForToggle(addon) {
        return (addon.isActive && ~~addon.pendingOperations.indexOf("PENDING_DISABLE"));
      }

      return context.createView({
        html:
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
          "</table>",
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
  },
  {
    name: "addon enable",
    description: gcli.lookup("addonEnableDesc"),
    params: [
      {
        name: "name",
        type: "addon",
        description: gcli.lookup("addonNameDesc")
      }
    ],
    exec: function(aArgs, context) {
      function enable(name, addons) {
        // Find the add-on.
        let addon = null;
        addons.some(function(candidate) {
          if (candidate.name == name) {
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
  },
  {
    name: "addon disable",
    description: gcli.lookup("addonDisableDesc"),
    params: [
      {
        name: "name",
        type: "addon",
        description: gcli.lookup("addonNameDesc")
      }
    ],
    exec: function(aArgs, context) {
      function disable(name, addons) {
        // Find the add-on.
        let addon = null;
        addons.some(function(candidate) {
          if (candidate.name == name) {
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
  }
];
