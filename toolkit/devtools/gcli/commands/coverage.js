/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { Cc, Ci } = require("chrome");

const { gDevTools } = require("resource:///modules/devtools/gDevTools.jsm");
const promise = require("resource://gre/modules/Promise.jsm").Promise;

const domtemplate = require("gcli/util/domtemplate");
const coverage = require("devtools/server/actors/coverage");
const l10n = coverage.l10n;

/**
 * The commands/converters for GCLI
 */
exports.items = [
  {
    name: "coverage",
    hidden: true,
    description: l10n.lookup("coverageDesc"),
  },
  {
    name: "coverage start",
    hidden: true,
    description: l10n.lookup("coverageStartDesc"),
    exec: function*(args, context) {
      let usage = yield coverage.getUsage(context.environment.target);
      yield usage.start(context.environment.chromeWindow,
                        context.environment.target);
    }
  },
  {
    name: "coverage stop",
    hidden: true,
    description: l10n.lookup("coverageStopDesc"),
    exec: function*(args, context) {
      let target = context.environment.target;
      let usage = yield coverage.getUsage(target);
      yield usage.stop();
      yield gDevTools.showToolbox(target, "styleeditor");
    }
  },
  {
    name: "coverage oneshot",
    hidden: true,
    description: l10n.lookup("coverageOneShotDesc"),
    exec: function*(args, context) {
      let target = context.environment.target;
      let usage = yield coverage.getUsage(target);
      yield usage.oneshot();
      yield gDevTools.showToolbox(target, "styleeditor");
    }
  },
  {
    name: "coverage toggle",
    hidden: true,
    description: l10n.lookup("coverageToggleDesc"),
    exec: function*(args, context) {
      let target = context.environment.target;
      let usage = yield coverage.getUsage(target);

      let running = yield usage.toggle();
      if (running) {
        return l10n.lookup("coverageRunningReply");
      }

      yield usage.stop();
      yield gDevTools.showToolbox(target, "styleeditor");
    }
  },
  {
    name: "coverage report",
    hidden: true,
    description: l10n.lookup("coverageReportDesc"),
    exec: function*(args, context) {
      let usage = yield coverage.getUsage(context.environment.target);
      return {
        isTypedData: true,
        type: "coveragePageReport",
        data: yield usage.createPageReport()
      };
    }
  },
  {
    item: "converter",
    from: "coveragePageReport",
    to: "dom",
    exec: function(coveragePageReport, context) {
      let target = context.environment.target;
      return gDevTools.showToolbox(target, "styleeditor").then(toolbox => {
        let panel = toolbox.getCurrentPanel();

        let addOnClick = rule => {
          rule.onclick = () => {
            panel.selectStyleSheet(rule.url, rule.start.line);
          };
        };

        let reportElement = panel._panelDoc.querySelector(".coverage-template");
        reportElement.hidden = false;

        let data = {
          pages: coveragePageReport.pages,
          unusedRules: coveragePageReport.unusedRules,
          onback: () => { reportElement.hidden = true; }
        };

        data.pages.forEach(page => {
          page.preloadRules.forEach(addOnClick);
        });

        data.unusedRules.forEach(addOnClick);

        let options = { allowEval: true, stack: "styleeditor.xul" };
        domtemplate.template(reportElement, data, options);
      });
    }
  }
];
