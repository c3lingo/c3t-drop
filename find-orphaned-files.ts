'use strict';

import path = require('path');
import _ = require('lodash');
import bunyan = require('bunyan');

import TalkModel from './models/talks';
import * as config from './config';

const log = bunyan.createLogger({ name: 'c3t-drop-server' });

const schedulePath = path.resolve(__dirname, 'schedule.json');
const filesBase = path.resolve(__dirname, 'files/');

const Talk = TalkModel(config, filesBase);

Promise.all([ Talk.all(), Talk._getAllFiles() ])
	.then(([ talks, files ]) => {
		log.info("talks:", talks.length);
		_(files)
			.each((meta, filePath) => {
				if (!meta.isDir) return;
				// Ignore root-level directory
				const nestLevel = filePath.split('/').length - schedulePath.split('/').length;
				if (nestLevel < 1) return;

				const matchingTalk = _(talks).find(t => t.filePath === filePath);
				if (!matchingTalk) {
					console.warn(filePath);
				}
			})
	})
	.then(() => process.exit())
