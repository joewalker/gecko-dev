/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const gcli = require('gcli/index');

loader.lazyGetter(this, "gDevTools",
  () => Cu.import("resource:///modules/devtools/gDevTools.jsm", {}).gDevTools);


module.exports.items = [
{
  name: "profiler",
  description: gcli.lookup("profilerDesc"),
  manual: gcli.lookup("profilerManual")
},
{
  name: "profiler open",
  description: gcli.lookup("profilerOpenDesc"),
  exec: function (args, context) {
    return gDevTools.showToolbox(context.environment.target, "jsprofiler")
      .then(function () null);
  }
},
{
  name: "profiler close",
  description: gcli.lookup("profilerCloseDesc"),
  exec: function (args, context) {
    if (!getPanel(context, "jsprofiler"))
      return;

    return gDevTools.closeToolbox(context.environment.target)
      .then(function () null);
  }
},
{
  name: "profiler start",
  description: gcli.lookup("profilerStartDesc"),
  returnType: "string",
  exec: function (args, context) {
    function start() {
      let panel = getPanel(context, "jsprofiler");

      if (panel.recordingProfile)
        throw gcli.lookup("profilerAlreadyStarted2");

      panel.toggleRecording();
      return gcli.lookup("profilerStarted2");
    }

    return gDevTools.showToolbox(context.environment.target, "jsprofiler")
      .then(start);
  }
},
{
  name: "profiler stop",
  description: gcli.lookup("profilerStopDesc"),
  returnType: "string",
  exec: function (args, context) {
    function stop() {
      let panel = getPanel(context, "jsprofiler");

      if (!panel.recordingProfile)
        throw gcli.lookup("profilerNotStarted3");

      panel.toggleRecording();
      return gcli.lookup("profilerStopped");
    }

    return gDevTools.showToolbox(context.environment.target, "jsprofiler")
      .then(stop);
  }
},
{
  name: "profiler list",
  description: gcli.lookup("profilerListDesc"),
  returnType: "dom",
  exec: function (args, context) {
    let panel = getPanel(context, "jsprofiler");

    if (!panel) {
      throw gcli.lookup("profilerNotReady");
    }

    let doc = panel.document;
    let div = createXHTMLElement(doc, "div");
    let ol = createXHTMLElement(doc, "ol");

    for ([ uid, profile] of panel.profiles) {
      let li = createXHTMLElement(doc, "li");
      li.textContent = profile.name;
      if (profile.isStarted) {
        li.textContent += " *";
      }
      ol.appendChild(li);
    }

    div.appendChild(ol);
    return div;
  }
},
{
  name: "profiler show",
  description: gcli.lookup("profilerShowDesc"),
  params: [
    {
      name: "name",
      type: "string",
      manual: gcli.lookup("profilerShowManual")
    }
  ],

  exec: function (args, context) {
    let panel = getPanel(context, "jsprofiler");

    if (!panel) {
      throw gcli.lookup("profilerNotReady");
    }

    let profile = panel.getProfileByName(args.name);
    if (!profile) {
      throw gcli.lookup("profilerNotFound");
    }

    panel.sidebar.selectedItem = panel.sidebar.getItemByProfile(profile);
  }

function getPanel(context, id) {
  if (context == null) {
    return undefined;
  }

  let toolbox = gDevTools.getToolbox(context.environment.target);
  return toolbox == null ? undefined : toolbox.getPanel(id);
}

function createXHTMLElement(document, tagname) {
  return document.createElementNS("http://www.w3.org/1999/xhtml", tagname);
}
}];
