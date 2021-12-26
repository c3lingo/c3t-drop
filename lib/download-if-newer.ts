
import bunyan = require('bunyan');
import fs = require('fs-promise');
import moment = require('moment');
import crypto = require('crypto');
import axios from 'axios';

const log = bunyan.createLogger({ name: 'download-if-newer' });

export default function downloadIfNewer(url: string, fileName: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const mtime = fs.existsSync(fileName) ? fs.statSync(fileName).mtime : null;
    axios({
      method: 'get',
      url: url,
      responseType: 'stream',
      headers: mtime != null ? { "If-Modified-Since": mtime.toUTCString() } : {},
    }).then((response) => {
      const tempFileName = 'download-' + crypto.randomBytes(16).toString('hex');
      const fileStream = fs.createWriteStream(tempFileName);
      response.data.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        const lastModified = response.headers['last-modified'];
        if (lastModified) {
          const rtime = moment(lastModified).toDate();
          fs.utimesSync(fileName, rtime, rtime);
        }
        fs.renameSync(tempFileName, fileName);
        log.info(`${fileName} downloaded`);
        resolve(true);
      });
      fileStream.on('error', (error) => {
        fs.remove(tempFileName);
        log.error(`error writing ${fileName}: ${error}`);
        reject(error);
      });
    }).catch((error) => {
      if (error.response) {
        if (error.response.status == 304) {
          log.info(`${fileName} unchanged`);
        } else {
          log.warn(`${fileName} download failed with status ${error.response.status}`);
        }
      } else {
        log.error(`error downloading ${fileName}: ${error}`);
      }
      resolve(false);
    });
  });
}
