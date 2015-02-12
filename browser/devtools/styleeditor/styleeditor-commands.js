/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const l10n = require("gcli/l10n");

exports.items = [{
  item: "command",
  runAt: "client",
  name: "edit",
  description: l10n.lookup("editDesc"),
  manual: l10n.lookup("editManual2"),
  params: [
     {
       name: 'resource',
       type: {
         name: 'resource',
         include: 'text/css'
       },
       description: l10n.lookup("editResourceDesc")
     },
     {
       name: "line",
       defaultValue: 1,
       type: {
         name: "number",
         min: 1,
         step: 10
       },
       description: l10n.lookup("editLineToJumpToDesc")
     }
   ],
   exec: function(args, context) {
     let target = context.environment.target;
     let gDevTools = require("resource:///modules/devtools/gDevTools.jsm").gDevTools;
     return gDevTools.showToolbox(target, "styleeditor").then(function(toolbox) {
       let styleEditor = toolbox.getCurrentPanel();
       styleEditor.selectStyleSheet(args.resource.element, args.line);
       return null;
     });
   }
}];
