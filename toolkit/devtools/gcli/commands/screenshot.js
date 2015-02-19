/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { Cc, Ci, Cu } = require("chrome");
const l10n = require("gcli/l10n");
const { Services } = require("resource://gre/modules/Services.jsm");

loader.lazyImporter(this, "Downloads", "resource://gre/modules/Downloads.jsm");
loader.lazyImporter(this, "LayoutHelpers", "resource://gre/modules/devtools/LayoutHelpers.jsm");
loader.lazyImporter(this, "Task", "resource://gre/modules/Task.jsm");
loader.lazyImporter(this, "OS", "resource://gre/modules/osfile.jsm");

const BRAND_SHORT_NAME = Cc["@mozilla.org/intl/stringbundle;1"]
                           .getService(Ci.nsIStringBundleService)
                           .createBundle("chrome://branding/locale/brand.properties")
                           .GetStringFromName("brandShortName");

// String used as an indication to generate default file name in the following
// format: "Screen Shot yyyy-mm-dd at HH.MM.SS.png"
const FILENAME_DEFAULT_VALUE = " ";

exports.items = [
  {
    /**
     * Format an 'imageSummary' (as output by the screenshot command).
     * An 'imageSummary' is a simple JSON object that looks like this:
     *
     * {
     *   destinations: [ "..." ], // Required array of descriptions of the
     *                            // locations of the result image (the command
     *                            // can have multiple outputs)
     *   data: "...",             // Optional Base64 encoded image data
     *   width:1024, height:768,  // Dimensions of the image data, required
     *                            // if data != null
     *   filename: "...",         // If set, clicking the image will open the
     *                            // folder containing the given file
     *   href: "...",             // If set, clicking the image will open the
     *                            // link in a new tab
     * }
     */
    item: "converter",
    from: "imageSummary",
    to: "dom",
    exec: function(imageSummary, context) {
      const document = context.document;
      const root = document.createElement("div");

      // Add a line to the result for each destination
      imageSummary.destinations.forEach(destination => {
        const title = document.createElement("div");
        title.textContent = destination;
        root.appendChild(title);
      });

      // Add the thumbnail image
      if (imageSummary.data != null) {
        const image = context.document.createElement("div");
        const previewHeight = parseInt(256 * imageSummary.height / imageSummary.width);
        const style = "" +
            "width: 256px;" +
            "height: " + previewHeight + "px;" +
            "max-height: 256px;" +
            "background-image: url('" + imageSummary.data + "');" +
            "background-size: 256px " + previewHeight + "px;" +
            "margin: 4px;" +
            "display: block;";
        image.setAttribute("style", style);
        root.appendChild(image);
      }

      // Click handler
      if (imageSummary.filename) {
        root.style.cursor = "pointer";
        root.addEventListener("click", () => {
          if (imageSummary.filename) {
            const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
            file.initWithPath(imageSummary.filename);
            file.reveal();
          }
        });
      }

      return root;
    }
  },
  {
    item: "command",
    runAt: "server",
    name: "screenshot",
    description: l10n.lookup("screenshotDesc"),
    manual: l10n.lookup("screenshotManual"),
    returnType: "imageSummary",
    buttonId: "command-button-screenshot",
    buttonClass: "command-button command-button-invertable",
    tooltipText: l10n.lookup("screenshotTooltip"),
    params: [
      {
        name: "filename",
        type: "string",
        defaultValue: FILENAME_DEFAULT_VALUE,
        description: l10n.lookup("screenshotFilenameDesc"),
        manual: l10n.lookup("screenshotFilenameManual")
      },
      {
        group: l10n.lookup("screenshotGroupOptions"),
        params: [
          {
            name: "clipboard",
            type: "boolean",
            description: l10n.lookup("screenshotClipboardDesc"),
            manual: l10n.lookup("screenshotClipboardManual")
          },
          {
            name: "imgur",
            type: "boolean",
            description: gcli.lookup("screenshotImgurDesc"),
            manual: gcli.lookup("screenshotImgurManual")
          },
          {
            name: "chrome",
            type: "boolean",
            description: l10n.lookupFormat("screenshotChromeDesc2", [BRAND_SHORT_NAME]),
            manual: l10n.lookupFormat("screenshotChromeManual2", [BRAND_SHORT_NAME])
          },
          {
            name: "delay",
            type: { name: "number", min: 0 },
            defaultValue: 0,
            description: l10n.lookup("screenshotDelayDesc"),
            manual: l10n.lookup("screenshotDelayManual")
          },
          {
            name: "fullpage",
            type: "boolean",
            description: l10n.lookup("screenshotFullPageDesc"),
            manual: l10n.lookup("screenshotFullPageManual")
          },
          {
            name: "selector",
            type: "node",
            defaultValue: null,
            description: l10n.lookup("inspectNodeDesc"),
            manual: l10n.lookup("inspectNodeManual")
          }
        ]
      }
    ],
    exec: function(args, context) {
      if (args.chrome && args.selector) {
        // Node screenshot with chrome option does not work as intended
        // Refer https://bugzilla.mozilla.org/show_bug.cgi?id=659268#c7
        // throwing for now.
        throw new Error(l10n.lookup("screenshotSelectorChromeConflict"));
      }
      var document = args.chrome? context.environment.chromeDocument
                                : context.environment.document;
      if (args.delay > 0) {
        var deferred = context.defer();
        document.defaultView.setTimeout(() => {
          this.grabScreen(document, args.filename, args.clipboard,
                          args.fullpage).then(deferred.resolve, deferred.reject);
        }, args.delay * 1000);
        return deferred.promise;
      }

      return this.grabScreen(document, args.filename, args.clipboard,
                             args.fullpage, args.selector, args.imgur, context);
    },
    grabScreen: function(document, filename, clipboard, fullpage, node, imgur, context) {
      return Task.spawn(function*() {
        // Check for default save to file functionality
        const saveToFile = (!imgur && !clipboard);

        let window = document.defaultView;
        let canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
        let left = 0;
        let top = 0;
        let width;
        let height;
        let currentX = window.scrollX;
        let currentY = window.scrollY;

        if (fullpage) {
          // Bug 961832: GCLI screenshot shows fixed position element in wrong
          // position if we don't scroll to top
          window.scrollTo(0,0);
          width = window.innerWidth + window.scrollMaxX;
          height = window.innerHeight + window.scrollMaxY;
        } else if (node) {
          let lh = new LayoutHelpers(window);
          let rect = lh.getRect(node, window);
          top = rect.top;
          left = rect.left;
          width = rect.width;
          height = rect.height;
        } else {
          left = window.scrollX;
          top = window.scrollY;
          width = window.innerWidth;
          height = window.innerHeight;
        }

        let winUtils = window.QueryInterface(Ci.nsIInterfaceRequestor)
                             .getInterface(Ci.nsIDOMWindowUtils);
        let scrollbarHeight = {};
        let scrollbarWidth = {};
        winUtils.getScrollbarSize(false, scrollbarWidth, scrollbarHeight);
        width -= scrollbarWidth.value;
        height -= scrollbarHeight.value;

        canvas.width = width;
        canvas.height = height;
        let ctx = canvas.getContext("2d");
        ctx.drawWindow(window, left, top, width, height, "#fff");
        let data = canvas.toDataURL("image/png", "");

        // See comment above on bug 961832
        if (fullpage) {
          window.scrollTo(currentX, currentY);
        }

        const reply = {
          destinations: [],
          data: data,
          height: height,
          width: width,
          filename: filename
        };

        let loadContext = document.defaultView
                                  .QueryInterface(Ci.nsIInterfaceRequestor)
                                  .getInterface(Ci.nsIWebNavigation)
                                  .QueryInterface(Ci.nsILoadContext);

        if (clipboard) {
          try {
            let io = Cc["@mozilla.org/network/io-service;1"]
                      .getService(Ci.nsIIOService);
            let channel = io.newChannel2(data,
                                         null,
                                         null,
                                         null,      // aLoadingNode
                                         Services.scriptSecurityManager.getSystemPrincipal(),
                                         null,      // aTriggeringPrincipal
                                         Ci.nsILoadInfo.SEC_NORMAL,
                                         Ci.nsIContentPolicy.TYPE_IMAGE);
            let input = channel.open();
            let imgTools = Cc["@mozilla.org/image/tools;1"]
                            .getService(Ci.imgITools);

            let container = {};
            imgTools.decodeImageData(input, channel.contentType, container);

            let wrapped = Cc["@mozilla.org/supports-interface-pointer;1"]
                            .createInstance(Ci.nsISupportsInterfacePointer);
            wrapped.data = container.value;

            let trans = Cc["@mozilla.org/widget/transferable;1"]
                          .createInstance(Ci.nsITransferable);
            trans.init(loadContext);
            trans.addDataFlavor(channel.contentType);
            trans.setTransferData(channel.contentType, wrapped, -1);

            let clipid = Ci.nsIClipboard;
            let clip = Cc["@mozilla.org/widget/clipboard;1"].getService(clipid);
            clip.setData(trans, null, clipid.kGlobalClipboard);

            reply.destinations.push(l10n.lookup("screenshotCopied"));
          }
          catch (ex) {
            console.error(ex);
            reply.destinations.push(l10n.lookup("screenshotErrorCopying"));
          }
        }

        let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);

        // Create a name for the file if not present
        if (filename == FILENAME_DEFAULT_VALUE) {
          let date = new Date();
          let dateString = date.getFullYear() + "-" + (date.getMonth() + 1) +
                          "-" + date.getDate();
          dateString = dateString.split("-").map(function(part) {
            if (part.length == 1) {
              part = "0" + part;
            }
            return part;
          }).join("-");
          let timeString = date.toTimeString().replace(/:/g, ".").split(" ")[0];
          filename = l10n.lookupFormat("screenshotGeneratedFilename",
                                      [dateString, timeString]) + ".png";
        }

        // Upload to imgur if desired
        if (imgur) {
          try {
            var xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
            var fd = Cc["@mozilla.org/files/formdata;1"].createInstance(Ci.nsIDOMFormData);
            fd.append("image", data.split(',')[1]);
            fd.append("type", "base64");
            fd.append("title", filename);

            var postURL = Services.prefs.getCharPref("devtools.gcli.imgurUploadURL");
            var clientID = 'Client-ID ' + Services.prefs.getCharPref("devtools.gcli.imgurClientID");
            xhr.open("POST", postURL);
            xhr.setRequestHeader('Authorization', clientID);
            xhr.send(fd);
            xhr.responseType = "json";

            div.textContent = gcli.lookup("screenshotImgurUploading");

            xhr.onreadystatechange = function() {
              if (xhr.readyState==4 && xhr.status==200) {
                reply.destinations.push(xhr.response.data.link);
              }
            }
          }
          catch(ex) {
            if (ex) {
              div.textContent = gcli.lookup("screenshotImgurError");
            }
          }
        }

        // If not imgur and not clipboard: save to file
        if (saveToFile) {
          // Check there is a .png extension to filename
          if (!filename.match(/.png$/i)) {
            filename += ".png";
          }
          // If the filename is relative, tack it onto the download directory
          if (!filename.match(/[\\\/]/)) {
            let preferredDir = yield Downloads.getPreferredDownloadsDirectory();
            filename = OS.Path.join(preferredDir, filename);
          }

          try {
            file.initWithPath(filename);
          } catch (ex) {
            console.error(ex);
            throw new Error(l10n.lookup("screenshotErrorSavingToFile") + " " + filename);
          }

          let ioService = Cc["@mozilla.org/network/io-service;1"]
                            .getService(Ci.nsIIOService);

          let Persist = Ci.nsIWebBrowserPersist;
          let persist = Cc["@mozilla.org/embedding/browser/nsWebBrowserPersist;1"]
                          .createInstance(Persist);
          persist.persistFlags = Persist.PERSIST_FLAGS_REPLACE_EXISTING_FILES |
                                 Persist.PERSIST_FLAGS_AUTODETECT_APPLY_CONVERSION;

          // TODO: UTF8? For an image?
          let source = ioService.newURI(data, "UTF8", null);
          persist.saveURI(source, null, null, 0, null, null, file, loadContext);

          reply.destinations.push(l10n.lookup("screenshotSavedToFile") + " \"" + filename + "\"");
        }

        return reply;
      });
    }
  }
];
