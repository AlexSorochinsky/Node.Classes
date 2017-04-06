// Filename : Server.js
//-----------------------------------------------------------------------------
// Project : Dashin Diamonds
// Language : Javascript
// Date of creation : 22.09.2016
//-----------------------------------------------------------------------------
// Node express and socket server class
//-----------------------------------------------------------------------------

global.Server = {

	Config: {},

	start: function(properties) {

		global._ = require('underscore');
		_.str = require('underscore.string');
		_.mixin(_.str.exports());

		_.extend(this, properties);

		process.title = properties.Name;

		this.Connections = {};

		this.ConnectionsUID = 0;

		/*################ Connecting Libraries ###############*/

		this.Logger = require('log4js').getLogger();

		/*################ Connecting to Database ################*/

		if (this.Config.Database) {

			this.Mongoose = require('mongoose');
			this.Mongoose.Promise = global.Promise;
			this.Mongoose.connect(this.Config.Database.Url || 'mongodb://localhost/test');

			this.Database = this.Mongoose.connection;
			this.Database.on('error', console.error.bind(console, 'connection error:'));
			this.Database.once('open', function() {

				this.Logger.debug('Connection to MongoDB established. Database: ' + (this.Config.Database.Url || 'mongodb://localhost/test'));

				this._start();

			}.bind(this));

		} else {

			this._start();

		}

	},

	_start: function() {

		/*################ Create Express Application ################*/

		var express = require('express'),
			cookie_parser = require('cookie-parser');

		this.Express = express();

		Broadcast.call("Before Express Callbacks");

		this.Express.use(function(req, res, next) {

			res.header("Access-Control-Allow-Origin", req.headers.origin);
			res.header("Access-Control-Allow-Credentials", "true");
			res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
			res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

			next();

		});

		this.Express.use(require('compression')());
		this.Express.use(require('cookie-parser')());
		this.Express.use(require('body-parser').json({limit:'5mb'}));
		this.Express.use(require('body-parser').urlencoded({limit:'5mb', extended:true}));

		if (this.Config.Public && this.Config.Public.Path) {

			this.Express.use(express.static((this.Config.Public && this.Config.Public.Path) ? (__dirname + this.Config.Public.Path) : (__dirname + '/../../Client/')));
		
			this.Logger.debug('Public files is opened to the world. Public folder: ' + (__dirname + this.Config.Public.Path));

		}

		if (this.Config.Session) {

			var express_session = require('express-session'),
				mongo_store = require('connect-mongo')(express_session);

			var session_store = new mongo_store({ mongooseConnection: this.Database });

			var session = express_session({
				name: 'sid',
				store: session_store,
				secret: this.Config.Session.Secret,
				saveUninitialized: true,
				resave: true,
				cookie: {
					path: '/',
					httpOnly: true,
					secure: false,
					maxAge: null
				}
			});

			this.Express.use(session);

		}

		this.Express.options('*', function(req, res) {

			res.send(200);

		});

		this.Express.get('/*', function(req, res, next) {

			if (req.headers.host.match(/^www/) !== null ) {

				res.redirect('http://' + req.headers.host.replace(/^www\./, '') + req.url);

			} else {

				next();

			}

		});

		this.Express.get('/', function(req, res, next) {

			res.redirect('/index.html');

		});

		/*################ Include business logic ################*/

		if (this.requireServices) this.requireServices();

		/*################ Launch servers ################*/

		var http_server = require('http').createServer(this.Express).listen(this.Config.Port, function() {

			this.Logger.debug("Express server listening on port " + this.Config.Port);

		}.bind(this));

		var websocket_server = require('websocket').server;

		var websocket_server_instance = new websocket_server({
			httpServer: http_server
		});

		websocket_server_instance.on('request', function(req) {

			var cookies = _.indexBy(req.cookies, 'name') || {};

			if (this.Config.Session) {

				var session_id = cookies['sid'] ? cookie_parser.signedCookie(cookies['sid'].value, this.Config.Cookie.Secret) : '';

				session_store.get(session_id, function(err, session) {

					this.socketHandler(req, session);

				}.bind(this));

			} else {

				this.socketHandler(req);

			}

		}.bind(this));

	},

	socketHandler: function (req, session) {

		var connection_id = this.ConnectionsUID++;

		var connection_data = this.Connections[connection_id] = {

			ConnectionID: connection_id,

			Connection: req.accept(null, req.origin),

			Session: session

		};

		this.Logger.debug('Connection #' + connection_id + ' accepted');

		connection_data.Connection.on('message', function (message) {

			if (message.type === 'utf8') {

				if (message.utf8Data && message.utf8Data.length > 10000) return this.Logger.debug('Receive message rejected by utf8Data length');

				var message_data = JSON.parse(message.utf8Data);
				if (!message_data) return;

				if (this.Config.IsLogUtf8Data) this.Logger.debug('Received Message #' + connection_id + ': ' + message.utf8Data);

				Broadcast.call('Client Data Received', [connection_data, message_data]);

			} else {

				if (this.Config.IsLogUnknownData) this.Logger.debug('Received Unknown Message', message);

			}

		}.bind(this));

		connection_data.Connection.on('close', function(connection) {

			this.Logger.debug('Connection #' + connection_id + ' closed');

			delete this.Connections[connection_id];

			Broadcast.call('Connection Closed', [connection_data]);

		}.bind(this));

		//Выполняем каллбэки на подключение
		Broadcast.call('Connection Accepted', [connection_data]);

	},

	foreachConnections: function(iterator) {

		_.each(this.Connections, iterator);

	},

	sendToConnection: function(connection_data, data) {

		connection_data.Connection.sendUTF(JSON.stringify(data));

	},

	send: function(res, data) {

		try {res.send(data);} catch (e) {}

	}

};