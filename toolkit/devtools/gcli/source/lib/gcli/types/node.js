/*
 * Copyright 2012, Mozilla Foundation and contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var Promise = require('../util/promise').Promise;
var Highlighter = require('../util/host').Highlighter;
var l10n = require('../util/l10n');
var util = require('../util/util');
var Status = require('./types').Status;
var Conversion = require('./types').Conversion;
var BlankArgument = require('./types').BlankArgument;

/**
 * windowHolder is a way to get at a window/document/etc. The page that we're
 * looking at could change, so a call to windowHolder.window could change
 * between calls from the event loop.
 */
var windowHolder;
if (typeof document !== 'undefined') {
  windowHolder = {
    window: document.defaultView,
  };
}

/**
 * Setter for the document that contains the nodes we're matching
 */
exports.setWindowHolder = function(wh) {
  windowHolder = wh;
};

/**
 * Getter for the document that contains the nodes we're matching
 * Most for changing things back to how they were for unit testing
 */
exports.getWindowHolder = function() {
  return windowHolder;
};

/**
 * Helper functions to be attached to the prototypes of NodeType and
 * NodeListType to allow terminal to tell us which nodes should be highlighted
 */
function onEnter(assignment) {
  assignment.highlighter = new Highlighter(windowHolder.window.document);
  assignment.highlighter.nodelist = assignment.conversion.matches;
}

/** @see #onEnter() */
function onLeave(assignment) {
  if (!assignment.highlighter) {
    return;
  }

  assignment.highlighter.destroy();
  delete assignment.highlighter;
}
/** @see #onEnter() */
function onChange(assignment) {
  if (assignment.conversion.matches == null) {
    return;
  }
  if (!assignment.highlighter) {
    return;
  }

  assignment.highlighter.nodelist = assignment.conversion.matches;
}

/**
 * The exported 'node' and 'nodelist' types
 */
exports.items = [
  {
    // The 'node' type is a CSS expression that refers to a single node
    item: 'type',
    name: 'node',

    getSpec: function(commandName, paramName) {
      return {
        name: 'remote',
        commandName: commandName,
        paramName: paramName
      };
    },

    stringify: function(value, context) {
      if (value == null) {
        return '';
      }
      return value.__gcliQuery || 'Error';
    },

    parse: function(arg, context) {
      var reply;

      if (arg.text === '') {
        reply = new Conversion(undefined, arg, Status.INCOMPLETE);
      }
      else {
        var nodes;
        try {
          nodes = windowHolder.window.document.querySelectorAll(arg.text);
          if (nodes.length === 0) {
            reply = new Conversion(undefined, arg, Status.INCOMPLETE,
                                   l10n.lookup('nodeParseNone'));
          }
          else if (nodes.length === 1) {
            var node = nodes.item(0);
            node.__gcliQuery = arg.text;

            reply = new Conversion(node, arg, Status.VALID, '');
          }
          else {
            var msg = l10n.lookupFormat('nodeParseMultiple', [ nodes.length ]);
            reply = new Conversion(undefined, arg, Status.ERROR, msg);
          }

          reply.matches = nodes;
        }
        catch (ex) {
          reply = new Conversion(undefined, arg, Status.ERROR,
                                 l10n.lookup('nodeParseSyntax'));
        }
      }

      return Promise.resolve(reply);
    },

    onEnter: onEnter,
    onLeave: onLeave,
    onChange: onChange
  },
  {
    // The 'nodelist' type is a CSS expression that refers to a node list
    item: 'type',
    name: 'nodelist',

    // The 'allowEmpty' option ensures that we do not complain if the entered
    // CSS selector is valid, but does not match any nodes. There is some
    // overlap between this option and 'defaultValue'. What the user wants, in
    // most cases, would be to use 'defaultText' (i.e. what is typed rather than
    // the value that it represents). However this isn't a concept that exists
    // yet and should probably be a part of GCLI if/when it does.
    // All NodeListTypes have an automatic defaultValue of an empty NodeList so
    // they can easily be used in named parameters.
    allowEmpty: false,

    constructor: function() {
      if (typeof this.allowEmpty !== 'boolean') {
        throw new Error('Legal values for allowEmpty are [true|false]');
      }
    },

    getSpec: function() {
      return { name: 'nodelist', allowEmpty: this.allowEmpty };
    },

    getBlank: function(context) {
      var emptyNodeList = (windowHolder == null) ? [] :
              util.createEmptyNodeList(windowHolder.window.document);
      return new Conversion(emptyNodeList, new BlankArgument(), Status.VALID);
    },

    stringify: function(value, context) {
      if (value == null) {
        return '';
      }
      return value.__gcliQuery || 'Error';
    },

    parse: function(arg, context) {
      var reply;
      try {
        if (arg.text === '') {
          reply = new Conversion(undefined, arg, Status.INCOMPLETE);
        }
        else {
          var nodes = windowHolder.window.document.querySelectorAll(arg.text);

          if (nodes.length === 0 && !this.allowEmpty) {
            reply = new Conversion(undefined, arg, Status.INCOMPLETE,
                                   l10n.lookup('nodeParseNone'));
          }
          else {
            nodes.__gcliQuery = arg.text;
            reply = new Conversion(nodes, arg, Status.VALID, '');
          }

          reply.matches = nodes;
        }
      }
      catch (ex) {
        reply = new Conversion(undefined, arg, Status.ERROR,
                               l10n.lookup('nodeParseSyntax'));
      }

      return Promise.resolve(reply);
    },

    onEnter: onEnter,
    onLeave: onLeave,
    onChange: onChange
  }
];
