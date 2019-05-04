import mysql 			from "mysql";
import Broadcast 		from "../Broadcast/Broadcast";

export default class MySQL {

	constructor(config) {

		this.config = config;

		//Add on, off, call and other methods for events manipulation
		Broadcast.make(this);

	}

	connect() {

		return new Promise((resolve, reject) => {

			if (this.connection) this.connection.destroy();

			this.connection = mysql.createConnection({
				host: this.config.databaseHost,
				user: this.config.databaseUser,
				password: this.config.databasePassword,
				insecureAuth: true,
				timezone: 'utc',
				dateStrings: false
			});

			this.connection.connect((err) => {

				if (err) return reject(err);

				this.connection.query('USE `' + this.config.databaseName + '`;', [], (err) => {

					if (err) return reject(err);

					this.call("Connection Established");

					resolve();

					this.connection.query('SET GLOBAL wait_timeout = ' + (this.config.waitTimeout || 28800));

				});

			});

			this.connection.on('error', (err) => {

				this.call("Error", [err]);

			});

		});

	}

	//Single database request
	query(sql, data_array = [], result_format = null, options = {}) {

		return new Promise((resolve, reject) => {

			let connection = this.connection;

			if (options.connection) connection = options.connection;

			connection.query(sql, data_array, (err, res, fields) => {

				if (res && res.hasOwnProperty('insertId')) this.lastInsertID = res.insertId;
				if (res && res.hasOwnProperty('affectedRows')) this.lastAffectedRows = res.affectedRows;
				else if (res) this.lastAffectedRows = res.length;

				let result = !err;

				if (res && res !== true && this.lastAffectedRows > 0) {

					if (result_format === true) {
						result = res;
					} else if (result_format === 'one') {
						result = res[0];
					} else if (result_format === 'list') {
						result = [];
						for (let i = 0; res[i]; i++) result.push(res[i][fields[0].name]);
					} else if (result_format === 'one-value') {
						result = (res && res[0]) ? res[0][fields[0].name] : null;
					} else if (result_format) {
						result = {};
						for (let i = 0; res[i]; i++) result[res[i][result_format]] = res[i];
					} else if (result_format === 'affected-rows') {
						result = res.affectedRows;
					} else if (result_format === 'last-insert-id') {
						result = res.insertId;
					}

				} else {

					if (result_format === 'affected-rows' && res) {
						result = res.affectedRows;
					} else if (result_format === 'last-insert-id' && res) {
						result = res.insertId;
					} else {
						result = ((result_format && result_format !== 'one' && result_format !== 'one-value') ? [] : false);
					}

				}

				if (err) {

					if (!options.skipError) this.call("Request Error", [sql, data_array, err]);

					reject(err);

				} else {

					//console.log(222, result);

					resolve(result);

				}

			});

		}).catch((err) => {

			console.log(5555555);

			throw err;

		});

	}

	//Multiple database requests
	queries(queries, is_parallel = true) {

		if (is_parallel) {

			return Promise.all(queries.map((query_params) => this.query(...query_params)));

		} else {

			let chain = Promise.resolve();

			let results = [];

			queries.forEach((query_params) => {

				chain
				.then(() => {console.log(111, arguments); return this.query(...query_params)})
				.then((result) => {
					console.log(333, arguments);
					results.push(result);
				});

			});

			chain.then(() => {
				return results;
			});

			return chain;

		}

	}

}