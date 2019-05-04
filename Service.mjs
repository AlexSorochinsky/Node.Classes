// Filename : Service.mjs
//-----------------------------------------------------------------------------
// Project : Node.Classes
// Language : Javascript
// Date of creation : 12.05.2017
//-----------------------------------------------------------------------------
// Node service class
//-----------------------------------------------------------------------------

import _ from 'lodash';

export const Service = class {

	constructor(properties) {

		const mixins = properties.Libraries || [];

		delete properties.Libraries;

		let init = function() {};

		if (!this.Actions) this.Actions = {};

		if (!this.Routes) this.Routes = {};

		if (!this.Events) this.Events = {};

		if (properties.init) init = properties.init;

		if (!properties.Name) throw "Service must have own Name property! " + this.Name;

		Object.assign(this, properties);

		for (let i = 0; mixins[i]; i++) {

			if (!mixins[i].Name) throw "Library must have own Name property! " + this.Name;

			Object.assign(this, _.omit(mixins[i], ['init', 'Name', 'Actions', 'Routes', 'Events']));

		}

		this.init = () => {

			this.activateModel();

			this.activateActions(properties.Actions, this);

			this.activateRoutes(properties.Routes);

			this.activateEvents(properties.Events, this);

			for (let i=0; mixins[i]; i++) {

				this.activateActions(mixins[i].Actions, mixins[i]);

				this.activateRoutes(mixins[i].Routes);

				this.activateEvents(mixins[i].Events, mixins[i]);

			}

			init.apply(this, []);

			for (let i=0; mixins[i]; i++) {

				if (mixins[i].init) mixins[i].init.apply(this, []);

			}

		};

	}

	activateModel() {

		if (!this.Model) return;

		this.Schema = new App.Mongoose.Schema(this.Model, {

			toJSON: {

				virtuals: true

			},

			toObject: {

				virtuals: true

			}

		});

		if (this.modifySchema) this.Schema = this.modifySchema(this.Schema);

		this.Model = App.Mongoose.model(this.Name, this.Schema);

	}

	activateActions(actions, context) {

		Broadcast.on('Client Data Received', (connection_object, data) => {

			actions.forEach((fn, key) => {

				if (key in data) fn.apply(this, [connection_object, data[key], function(result) {

					App.sendToConnection(connection_object, result);

				}, data]);

			}, this);

			if (actions['*']) actions['*'].apply(this, [connection_object, data, function(result) {

				App.sendToConnection(connection_object, result);

			}]);

		}, context);

	}

	activateEvents(events, context) {

		_.each(events, (fn, event_name) => {

			Broadcast.on(event_name, fn, context);

		});

	}

	activateRoutes(routes) {

		_.each(routes, (fn, path) => {

			let type = 'get';

			if (path.indexOf('post:') === 0) {

				type = 'post';
				path = path.substr(5);

			}

			if (type === 'post') {

				App.Express.post(path, (req, res) => {

					fn.apply(this, [req, res, function(data) {

						App.send(res, data || '');

					}]);

				});

			} else if (type === 'get') {

				App.Express.get(path, (req, res) => {

					fn.apply(this, [req, res, function(data) {

						App.send(res, data || '');

					}]);

				});

			}

		}, this);

	}

};