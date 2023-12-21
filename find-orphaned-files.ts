'use strict';

import { resolve } from 'path';
import * as config from './config';
import TalkModel from './src/models/talks';

const schedulePath = resolve(__dirname, 'schedule.json');
const filesBase = resolve(__dirname, 'files/');

const Talk = TalkModel(config, filesBase);

Promise.all([Talk.all(), Talk._getAllFiles()])
  .then(([talks, files]) => {
    Object.entries(files).forEach(([filePath, meta]) => {
      if (!meta.isDir) return;
      // Ignore root-level directory
      const nestLevel = filePath.split('/').length - schedulePath.split('/').length;
      if (nestLevel < 1) return;

      const matchingTalk = talks.find((t) => t.filePath === filePath);
      if (!matchingTalk) {
        console.warn(filePath);
      }
    });
  })
  .then(() => process.exit());
