import mysql from 'mysql';

export default class MongoDB {

	constructor(config) {

		//Конфигурация переданная при создании объекта
		this.config = config;

		//Добавляем on, off, call и другие методы для работв с событиями
		Broadcast.make(this);

	}

	connect() {

		this.Mongoose = require('mongoose');
		this.Mongoose.Promise = global.Promise;
		this.Mongoose.connect(this.config.Database.Url || 'mongodb://localhost/test');

		this.Database = this.Mongoose.connection;
		this.Database.on('error', console.error.bind(console, 'connection error:'));
		this.Database.once('open', () => {

			this.logger.debug('Connection to MongoDB established. Database: ' + (this.config.Database.Url || 'mongodb://localhost/test'));

			if (this.onDatabaseReady) this.onDatabaseReady();

			this.start();

		});

	}

	//Запрос в БД
	query() {


	}

}