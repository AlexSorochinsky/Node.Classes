import _ 						from 'lodash';

import argsParser 				from 'args-parser';
import log4js 					from 'log4js';
import { exec } 				from 'child_process';

import fs 						from 'fs';
import http 					from 'http';
import https 					from 'https';
import websocket				from 'websocket';

import express 					from 'express';
import expressSession 			from 'express-session';
import expressSessionMySQL		from 'express-mysql-session';
import expressSessionMongoDB	from 'connect-mongo';
import compression 				from 'compression';
import cookieParser 			from 'cookie-parser';
import bodyParser 				from 'body-parser';

import MySQL 					from './Server.Database.MySQL';
import MongoDB 					from './Server.Database.MongoDB';

import Broadcast				from './../Broadcast/Broadcast';

global.Broadcast 	= Broadcast;
global._ 			= _;

export default class Server {

	constructor(config) {

		//Configuration specified in parameters
		this.config = config || {};

		//Socket connections with clients
		this.socketConnections = {};

		//Connections with databases
		this.databaseConnections = {};

		//Beautiful colored logs for console
		this.logger = log4js.getLogger();
		this.logger.level = 'debug';

		//Parse process arguments to object
		this.argv = argsParser(process.argv);

		this.basePath = fs.realpathSync('.');

		Object.assign(this, _.pickBy(this.config, (value, key) => {return !_.includes(['Database', 'WebServer', 'Session', 'Error', 'Vue'], key)}));

		this.prepare = this.prepare || _.identity;
		this.ready = this.ready || _.identity;
		this.cache = this.cache || _.identity;
		this.error = this.error || _.identity;

		//Call prepare callback function before we start anything
		this.prepare();

		this.createLogStorages();

		Promise.resolve().then(() => {

			return this.createDatabaseConnection(this.config.Database);

		})
		.then(() => {

			//Если не нужно создавать веб сервер
			if (!this.config.WebServer || this.config.WebServer.autoStart === false) return Promise.resolve();

			else return this.createHTTPServer(this.config.WebServer);

		}).then(() => {

			return this.createVueDevelopmentServer();

		}).catch((err) => {

			this.logError(err);

		}).then(() => {

			this.ready();

		}).catch((err) => {

			this.logError(err);

		});

	}

	createDatabaseConnection(database_config) {

		//Return if no server configuration
		if (!database_config) return Promise.resolve();

		if (database_config.type === "MySQL") return this.createMySQLDatabaseConnection(database_config);

		else if (database_config.type === "MongoDB") return this.createMongoDBDatabaseConnection(database_config);

		else throw new Error("Unknown database type");

	}

	createMySQLDatabaseConnection(database_config) {

		if (this.databaseConnections[database_config.name]) throw new Error("Database connection with name " + database_config.name + " already exist");

		const connection = this.databaseConnections[database_config.name] = new MySQL(database_config);

		connection.on("Connection Established", () => {

			this.log("Connection to MySQL established. Database: " + database_config.databaseName);

			Broadcast.call("Database Connection Established", [connection]);

		}, this);

		connection.on("Error", (err) => {

			this.logError("MySQL", err);

			if (err.code === 'PROTOCOL_CONNECTION_LOST') connection.connect();

		}, this);

		connection.on("Request Error", (sql, data_array, err) => {

			this.logError("MySQL",[sql, data_array, err]);

		}, this);

		return connection.connect();

	}

	createMongoDBDatabaseConnection(database_config) {

		const connection = this.databaseConnections[database_config.name] = new MongoDB(database_config);

		//Broadcast.call("Database Connection Established", [connection]);

		return connection.connect();

	}

	getDatabaseConnection(name) {

		const connection = this.databaseConnections[name];

		if (!connection) throw new Error("Database connection with name " + name + " doesn't exist");

		return connection;

	}

	createHTTPServer() {

		return new Promise((resolve, reject) => {

			this.Express = express();

			Broadcast.call("Before Express Callbacks");

			if (this.config.WebServer.allowCrossOrigin) {

				this.Express.use(function(req, res, next) {

					res.header("Access-Control-Allow-Origin", req.headers.origin);
					res.header("Access-Control-Allow-Credentials", "true");
					res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
					res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

					next();

				});

				this.Express.options('*', function(req, res) {

					res.send(200);

				});

			}

			if (this.config.WebServer.removeWWW) {

				this.Express.get('/*', function(req, res, next) {

					if (req.headers.host.match(/^www/) !== null) {

						res.redirect('http://' + req.headers.host.replace(/^www\./, '') + req.url);

					} else {

						next();

					}

				});

			}

			if (this.config.WebServer.redirectToIndex) {

				this.Express.get('/', function (req, res) {

					res.redirect('/index.html');

				});

			}

			this.Express.use(compression());
			this.Express.use(cookieParser());
			this.Express.use(bodyParser.json({limit: '5mb'}));
			this.Express.use(bodyParser.urlencoded({limit: '50mb', extended: true}));

			if (this.config.WebServer.publicPath) {

				const public_path = (this.config.WebServer.publicPath === true) ? (this.basePath + '/../../Client/') : (this.basePath + this.config.WebServer.publicPath);

				this.Express.use(express.static(public_path));

				this.logger.debug('Public files is opened to the world. Public folder: ' + public_path);

			}

			if (this.config.Session) {

				if (this.config.Session.type === "MySQL") {

					const MySQLStore = expressSessionMySQL(expressSession);

					let mySQLStoreConnection;

					if (typeof this.config.Session.connection === "string") {

						mySQLStoreConnection = this.getDatabaseConnection(this.config.Session.connection).connection;

					} else if (typeof this.config.Session.connection === "object") {

						//TODO: create new connection

					}

					const sessionStore = this.ExpressSessionStore = new MySQLStore({
						checkExpirationInterval: this.config.Session.checkExpirationInterval || 900000, // How frequently expired sessions will be cleared; milliseconds.
						expiration: this.config.Session.expiration || 2592000000, // The maximum age of a valid session; milliseconds.
						createDatabaseTable: true, // Whether or not to create the sessions database table, if one does not already exist.
						schema: {
							tableName: 'sessions',
							columnNames: {
								session_id: 'sid',
								expires: 'expires',
								data: 'data'
							}
						}
					}, mySQLStoreConnection);

					this.Express.use(expressSession({
						key: 'sid',
						secret: this.config.Session.secret,
						cookie: { domain: this.config.Session.domain, httpOnly: true, secure: false, maxAge: 30 * 24 * 3600 * 1000},
						store: sessionStore,
						domain: this.config.Session.domain,
						resave: true,
						saveUninitialized: true
					}));

				} else if (this.config.Session.type === "mongodb") {

					const MongoStore = expressSessionMongoDB(expressSession);

					const sessionStore = this.ExpressSessionStore = new MongoStore({mongooseConnection: this.Database});

					this.Express.use(expressSession({
						name: 'sid',
						secret: this.config.Session.secret,
						cookie: { path: '/', httpOnly: true, secure: false, maxAge: null },
						store: sessionStore,
						resave: true,
						saveUninitialized: true
					}));

				}

			}

			this.httpServer = http.createServer(this.Express).listen(this.config.WebServer.port, () => {

				this.logger.debug("Express server listening on port " + this.config.WebServer.port);

				if (this.config.WebServer.webSocket) this.createSocketServer();

				resolve();

			});

		});

	}

	createSocketServer() {

		const WebsocketServer = websocket.server;

		const websocketServerInstance = new WebsocketServer({
			httpServer: this.httpServer
		});

		websocketServerInstance.on('request', (req) => {

			const cookies = _.indexBy(req.cookies, 'name') || {};

			if (this.config.Session) {

				const sessionId = cookies['sid'] ? cookieParser.signedCookie(cookies['sid'].value, this.config.Cookie.secret) : '';

				this.ExpressSessionStore.get(sessionId, (err, session) => {

					this.socketHandler(req, session);

				});

			} else {

				this.socketHandler(req);

			}

		});

	}

	createVueDevelopmentServer() {

		return new Promise((resolve, reject) => {

			//Return if no Vue configuration
			if (!this.config.Vue) return resolve();

			//Return if not development mode
			if (App.DEVELOPMENT) {

				exec('npm run dev', {cwd: this.basePath + this.config.Vue.Path}, function (error, stdout, stderr) {

					if (error) {
						console.log(error.stack);
						console.log('Error code: ' + error.code);
						console.log('Signal received: ' + error.signal);
					}
					console.log('stdout: ' + stdout);
					console.log('stderr: ' + stderr);

				});

				this.log("Vue DEVELOPMENT server started at localhost:8080");

				resolve();

				/*const workerProcess = spawn('node_modules/.bin/watchify.cmd', ['-vd', '-p', 'browserify-hmr', '-e', 'src/main.js', '-o', 'dist/build.js'], {cwd: 'C:/MraidDevelopment/Fatenation2/Client/Game/Vue/node_modules/'});

				workerProcess.stdout.on('open', () => {
					this.log("Vue server started.");
				});

				workerProcess.stdout.on('data', function (data) {
					console.log('stdout: ' + data);
				});

				workerProcess.stderr.setEncoding('utf8');
				workerProcess.stderr.on('data', function (data) {
					console.log('stderr: ' + data);
				});

				workerProcess.on('close', function (code) {
					console.log('child process exited with code ' + code);
				});*/

			} else if (App.PRODUCTION) {

				//Build

			}

		});

	}

	socketHandler(req, session) {

		const connectionId = _.uniqueId();

		const connectionObject = this.socketConnections[connectionId] = {

			ConnectionID: connectionId,

			Connection: req.accept(null, req.origin),

			Session: session

		};

		this.logger.debug('Connection #' + connectionId + ' accepted');

		connectionObject.Connection.on('message', (message) => {

			if (message.type === 'utf8') {

				if (message.utf8Data && message.utf8Data.length > 10000) return this.logger.debug('Receive message rejected by utf8Data length');

				let message_data = JSON.parse(message.utf8Data);
				if (!message_data) return;

				if (this.config.IsLogUtf8Data) this.logger.debug('Received Message #' + connectionId + ': ' + message.utf8Data);

				Broadcast.call('Client Data Received', [connectionObject, message_data]);

			} else {

				if (this.config.IsLogUnknownData) this.logger.debug('Received Unknown Message', message);

			}

		});

		connectionObject.Connection.on('close', (connection) => {

			this.logger.debug('Connection #' + connectionId + ' closed');

			delete this.socketConnections[connectionId];

			Broadcast.call('Connection Closed', [connectionObject]);

		});

		//Выполняем каллбэки на подключение
		Broadcast.call('Connection Accepted', [connectionObject]);

	}

	foreachConnections(iterator) {

		_.each(this.socketConnections, iterator);

	}

	static sendToConnection(connectionObject, data) {

		connectionObject.Connection.sendUTF(JSON.stringify(data));

	}

	static send(res, data) {

		try {res.send(data);} catch (err) {

			App.logError(err);

		}

	}

	static parseArguments() {

		return argsParser(process.argv);

	}

	log() {

		this.logger.debug(...arguments);

	}

	warn() {

		this.logger.warn(...arguments);

	}

	logError(type, details) {

		if (typeof type !== "string") {
			details = type;
			type = "";
		}

		this.logger.error(type, details);

		if (this.config.Logs && this.config.Logs.errors) {

			if (this.config.Logs.errors.type === "MySQL") {

				if (this.config.Logs.errors.connectionObject) this.config.Logs.errors.connectionObject.query("INSERT INTO " + this.config.Logs.errors.tableName + " (date, type, data) VALUES (UTC_TIMESTAMP(), ?, ?);", [type, JSON.stringify({memory: process.memoryUsage(), details: details})], null, {skipError: true});

			}

		}

		//Additional actions
		this.error(type, details);

	}

	createLogStorages() {

		Broadcast.on("Database Connection Established", () => {

			if (this.config.Logs && this.config.Logs.errors) {

				if (this.config.Logs.errors.type === "MySQL") {

					if (!this.config.Logs.errors.tableName) this.config.Logs.errors.tableName = 'log_errors';

					if (this.databaseConnections[this.config.Logs.errors.connection]) this.config.Logs.errors.connectionObject = this.getDatabaseConnection(this.config.Logs.errors.connection);

					if (this.config.Logs.errors.connectionObject) {

						if (this.config.Logs.errors.createTable === true) this.config.Logs.errors.connectionObject.query("CREATE TABLE IF NOT EXISTS `" + this.config.Logs.errors.tableName + "` (`date` datetime NOT NULL, `type` varchar(255) NOT NULL, `data` text NOT NULL) ENGINE=MyISAM DEFAULT CHARSET=utf8;", [], null, {skipError: true});

					}

				}

			}

		}, this);

	}

};