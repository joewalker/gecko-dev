/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { Task } = require("resource://gre/modules/Task.jsm");
const {
  method, Arg, Option, RetVal, Front, FrontClass, Actor, ActorClass
} = require("devtools/server/protocol");
const events = require("sdk/event/core");

/**
 * Manage remote connections that want to talk to GCLI
 */
const GcliActor = ActorClass({
  typeName: "gcli",

  events: {
    "commands-changed" : {
      type: "commandsChanged",
      commandsChanged: Arg(0, "json")
    }
  },

  initialize: function(conn, tabActor) {
    Actor.prototype.initialize.call(this, conn);

    this._commandsChanged = this._commandsChanged.bind(this);

    this._tabActor = tabActor;
    this._requisitionPromise = undefined; // see _getRequisition()
  },

  destroy: function() {
    this._requisitionPromise = undefined;
    this._tabActor = undefined;

    protocol.Actor.prototype.destroy.call(this);

    return this._getRequisition().then(requisition => {
      requisition.system.commands.onCommandsChange.remove(this._commandsChanged);
      this._commandsChanged = undefined;
    });
  },

  /**
   * Retrieve a list of the remotely executable commands
   * @param customProps Array of strings containing additional properties which,
   * if specified in the command spec, will be included in the JSON. Normally we
   * transfer only the properties required for GCLI to function.
   */
  specs: method(function(customProps) {
    this._lastCustomProps = customProps;
    return this._getRequisition().then(requisition => {
      return requisition.system.commands.getCommandSpecs(customProps);
    });
  }, {
    request: {
      customProps: Arg(0, "nullable:array:string")
    },
    response: RetVal("json")
  }),

  /**
   * Execute a GCLI command
   * @return a promise of an object with the following properties:
   * - data: The output of the command
   * - type: The type of the data to allow selection of a converter
   * - error: True if the output was considered an error
   */
  execute: method(function(typed) {
    return this._getRequisition().then(requisition => {
      return requisition.updateExec(typed).then(output => output.toJson());
    });
  }, {
    request: {
      typed: Arg(0, "string") // The command string
    },
    response: RetVal("json")
  }),

  /**
   * Get the state of an input string. i.e. requisition.getStateData()
   */
  state: method(function(typed, start, rank) {
    return this._getRequisition().then(requisition => {
      return requisition.update(typed).then(() => {
        return requisition.getStateData(start, rank);
      });
    });
  }, {
    request: {
      typed: Arg(0, "string"), // The command string
      start: Arg(1, "number"), // Cursor start position
      rank: Arg(2, "number") // The prediction offset (# times UP/DOWN pressed)
    },
    response: RetVal("json")
  }),

  /**
   * Call type.parse to check validity. Used by the remote type
   * @return a promise of an object with the following properties:
   * - status: Of of the following strings: VALID|INCOMPLETE|ERROR
   * - message: The message to display to the user
   * - predictions: An array of suggested values for the given parameter
   */
  parseType: method(function(typed, param) {
    return this._getRequisition().then(requisition => {
      return requisition.update(typed).then(() => {
        let assignment = requisition.getAssignment(param);
        return Promise.resolve(assignment.predictions).then(predictions => {
          return {
            status: assignment.getStatus().toString(),
            message: assignment.message,
            predictions: predictions
          };
        });
      });
    });
  }, {
    request: {
      typed: Arg(0, "string"), // The command string
      param: Arg(1, "string") // The name of the parameter to parse
    },
    response: RetVal("json")
  }),

  /**
   * Get the incremented value of some type
   * @return a promise of a string containing the new argument text
   */
  incrementType: method(function(typed, param) {
    return this._getRequisition().then(requisition => {
      return requisition.update(typed).then(() => {
        let assignment = requisition.getAssignment(param);
        return requisition.increment(assignment).then(() => {
          return assignment.arg == null ? undefined : assignment.arg.text;
        });
      });
    });
  }, {
    request: {
      typed: Arg(0, "string"), // The command string
      param: Arg(1, "string") // The name of the parameter to parse
    },
    response: RetVal("string")
  }),

  /**
   * See incrementType
   */
  decrementType: method(function(typed, param) {
    return this._getRequisition().then(requisition => {
      return requisition.update(typed).then(() => {
        let assignment = requisition.getAssignment(param);
        return requisition.decrement(assignment).then(() => {
          return assignment.arg == null ? undefined : assignment.arg.text;
        });
      });
    });
  }, {
    request: {
      typed: Arg(0, "string"), // The command string
      param: Arg(1, "string") // The name of the parameter to parse
    },
    response: RetVal("string")
  }),

  /**
   * Perform a lookup on a selection type to get the allowed values
   */
  getSelectionLookup: method(function(commandName, paramName) {
    return this._getRequisition().then(requisition => {
      let type = this._getType(requisition, commandName, paramName);

      let context = requisition.executionContext;
      return type.lookup(context).map(info => {
        // lookup returns an array of objects with name/value properties and
        // the values might not be JSONable, so remove them
        return { name: info.name };
      });
    });
  }, {
    request: {
      commandName: Arg(0, "string"), // The command containing the parameter in question
      paramName: Arg(1, "string"),   // The name of the parameter
    },
    response: RetVal("json")
  }),

  /**
   * Perform a lookup on a selection type to get the allowed values
   */
  getSelectionData: method(function(commandName, paramName) {
    return this._getRequisition().then(requisition => {
      let type = this._getType(requisition, commandName, paramName);

      let context = requisition.executionContext;
      return type.data(context);
    });
  }, {
    request: {
      commandName: Arg(0, "string"), // The command containing the parameter in question
      paramName: Arg(1, "string"),   // The name of the parameter
    },
    response: RetVal("json")
  }),

  /**
   * Lazy init for a Requisition
   */
  _getRequisition: function() {
    if (this._requisitionPromise != null) {
      return this._requisitionPromise;
    }

    let gcliInit = require("devtools/commandline/commands-index");
    let Requisition = require("gcli/cli").Requisition;
    let tabActor = this._tabActor;

    this._requisitionPromise = gcliInit.loadForServer().then(system => {
      let environment = {
        get window() tabActor.window,
        get document() tabActor.window.document,
      };

      let requisition = new Requisition(system, { environment: environment });
      requisition.system.commands.onCommandsChange.add(this._commandsChanged);

      return requisition;
    });

    return this._requisitionPromise;
  },

  /**
   * Pass events from requisition.system.commands.onCommandsChange upwards
   */
  _commandsChanged: function() {
    events.emit(this, "commands-changed");
  },

  /**
   * Helper for #getSelectionLookup and #getSelectionData that finds a type
   * instance given a commandName and paramName
   */
  _getType: function(requisition, commandName, paramName) {
    let command = requisition.system.commands.get(commandName);
    if (command == null) {
      throw new Error("No command called '" + commandName + "'");
    }

    let type;
    command.params.forEach(param => {
      if (param.name === paramName) {
        type = param.type;
      }
    });

    if (type == null) {
      throw new Error("No parameter called '" + paramName + "' in '" +
                      commandName + "'");
    }

    return type;
  }
});

exports.GcliActor = GcliActor;

/**
 * 
 */
const GcliFront = exports.GcliFront = FrontClass(GcliActor, {
  initialize: function(client, tabForm) {
    Front.prototype.initialize.call(this, client);
    this.actorID = tabForm.gcliActor;

    // XXX: This is the first actor type in its hierarchy to use the protocol
    // library, so we're going to self-own on the client side for now.
    this.manage(this);
  },
});

// A cache of created fronts: WeakMap<Target, Front>
// TODO: CSSUsageFront has WeakMap<Target, Client> is there a good reason?
const knownFronts = new WeakMap();

/**
 * Create a GcliFront only when needed (returns a promise)
 * For notes on target.makeRemote(), see
 * https://bugzilla.mozilla.org/show_bug.cgi?id=1016330#c7
 */
exports.GcliFront.create = function(target) {
  return target.makeRemote().then(() => {
    let front = knownFronts.get(target);
    if (front == null && target.form.gcliActor != null) {
      front = new GcliFront(target.client, target.form);
      knownFronts.set(target, front);
    }
    return front;
  });
};
