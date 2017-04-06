var Service = global.Service = function (properties) {

	var libraries = properties.$libraries;

	var initializes = [];

	if (!properties.Actions) properties.Actions = {};

	if (libraries) for (var i = 0; libraries[i]; i++) {

		var library = require('../' + libraries[i]);

		if (library.initialize) {

			initializes.push(library.initialize);

			delete library.initialize;

		}

		if (library.Actions) {

			_.extend(properties.Actions, library.Actions);

			delete library.Actions;

		}

		if (library.Events) {

			_.extend(properties.Events, library.Events);

			delete library.Events;

		}

		_.extend(properties, library);
	}

	_.extend(properties, Service.Properties);

	properties.activateModel();

	properties.activateActions();

	properties.activateEvents();

	properties.activateRoutes();

	if (properties.initialize) properties.initialize.apply(properties, []);

	for (i = 0; initializes[i]; i++) initializes[i].apply(properties, []);

	return properties;

};

Service.Properties = {

	activateModel: function() {

		if (!this.Model) return;

		this.Schema = new Server.Mongoose.Schema(this.Model, {

			toJSON: {

				virtuals: true

			},

			toObject: {

				virtuals: true

			}

		});

		if (this.modifySchema) this.Schema = this.modifySchema(this.Schema);

		this.Model = Server.Mongoose.model(this.Name, this.Schema);

	},

	activateActions: function() {

		Broadcast.on('Client Data Received', function(connection_data, data) {

			_.each(this.Actions, function(fn, key) {

				if (key in data) fn.apply(this, [connection_data, data[key], function(result) {

				Server.sendToConnection(connection_data, result);

				}, data]);

			}, this);

			if (this.Actions['*']) this.Actions['*'].apply(this, [connection_data, data, function(result) {

				Server.sendToConnection(connection_data, result);

			}]);

		}, this);

	},

	activateEvents: function() {

		_.each(this.Events, function(fn, event_name) {

			Broadcast.on(event_name, fn, this);

		}, this);

	},

	activateRoutes: function() {

		_.each(this.Routes, function(params, path) {

			if (_.isFunction(params)) params = {process: params};

			var fn = params.process,
				_this = this;

			var type = 'post';

			if (path.indexOf('get:') === 0) {
				type = 'get';
				path = path.substr(4);
			}

			if (type == 'post') {

				Server.Express.post(path, function(req, res) {

					fn.apply(_this, [req, res, function(data) {

						Server.send(res, data || '');

					}]);

				});

			} else if (type == 'get') {

				Server.Express.get(path, function(req, res) {

					fn.apply(_this, [req, res, function(data) {

						Server.send(res, data || '');

					}]);

				});

			}

		}, this);

	}

};