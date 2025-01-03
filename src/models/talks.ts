'use strict';

import * as bunyan from 'bunyan';
import * as chokidar from 'chokidar';
import { createReadStream, type ReadStream, type Stats } from 'fs';
import * as fs from 'fs/promises';
import * as _ from 'lodash';
import * as path from 'path';

import redactFilename from '../lib/redact-filename';
import slugify from '../lib/slugify';
import sortTitle from '../lib/sort-title';
import streamHash from '../lib/stream-hash';

const COMMENT_EXTENSION = '.comment.txt';

export class TalkFile {
  name: string;
  redactedName: string;
  path: string;
  meta: any;

  constructor(filePath: string, meta: any) {
    this.name = path.basename(filePath);
    this.redactedName = redactFilename(this.name);
    this.path = filePath;
    this.meta = meta;
  }

  read() {
    return createReadStream(this.path);
  }
}

export interface FileInfo {
  stats: Stats;
  isComment?: boolean;
  hash?: string | null;
}

export default function TalkModel(
  config: { scheduleURLs: string | string[]; remoteScheduleUpdateInterval: number },
  fileRootPath: string,
  shouldLog = true
) {
  const log = bunyan.createLogger({ name: 'c3t-drop-model', level: shouldLog ? 'info' : 'fatal' });

  const scheduleJsonURLs: URL[] = (
    typeof config.scheduleURLs === 'string' ? [config.scheduleURLs] : config.scheduleURLs
  ).map(parseURL);

  let talks: Talk[] = [];
  let sortedTalks: Talk[] = [];
  let talksById: { [id: string]: Talk } = {};
  const files: {
    [path: string]: FileInfo;
  } = {};
  let filesLastUpdated = 0;
  let versionInformation: string | null = null;

  let talksReady = updateTalks();

  class Talk {
    id: string;
    date: Date;
    time: string;
    duration: string;
    room: string;
    title: string;
    sortTitle: string;
    subtitle?: string;
    slug: string;
    track: string;
    type: string;
    language: string;
    abstract?: string;
    day?: number;
    filePath: string;
    url: URL;

    speakers: string[];

    private filesCache: null | TalkFile[] = null;
    private commentFilesCache: null | TalkFile[] = null;
    private filesCacheLastUpdated = 0;
    private commentFilesCacheLastUpdated = 0;

    // TODO: Properly validate `type` parameter
    constructor(talk: any, day: number | null = null) {
      this.id = talk.guid;
      this.date = new Date(talk.date);
      this.time = talk.start;
      this.duration = talk.duration;
      this.room = talk.room;
      this.title = talk.title.trim();
      this.sortTitle = sortTitle(this.title);
      this.subtitle = talk.subtitle || undefined;
      this.slug = slugify(talk.title, talk.language);
      this.track = talk.track;
      this.type = talk.type;
      this.language = talk.language;
      this.abstract = talk.abstract || undefined;
      this.day = day === null ? undefined : day;
      this.filePath = path.resolve(fileRootPath, this.id);
      this.url = new URL(talk.url);

      this.speakers = talk.persons.map((p: any) => p.public_name ?? p.name);
    }

    get files(): TalkFile[] {
      if (!this.filesCache || this.filesCacheLastUpdated < filesLastUpdated) {
        this.filesCache = _(files)
          .map((meta, filePath) => ({ meta, path: filePath }))
          .filter((file) => !file.meta.isComment && file.path.indexOf(this.filePath) === 0)
          .map((file) => new TalkFile(file.path, file.meta))
          .value();
        this.filesCacheLastUpdated = Date.now();
      }
      return this.filesCache;
    }

    get commentFiles(): TalkFile[] {
      if (!this.commentFilesCache || this.commentFilesCacheLastUpdated < filesLastUpdated) {
        this.commentFilesCache = _.map(files, (info, filePath) => ({ info, path: filePath }))
          .filter((file) => file.info.isComment && file.path.indexOf(this.filePath) === 0)
          .map((file: { info: FileInfo; path: string }) => new TalkFile(file.path, file.info));
        this.commentFilesCacheLastUpdated = Date.now();
      }
      return this.commentFilesCache;
    }

    // This is NOT a getter because it is asynchronous
    getComments(): Promise<{ body: Buffer; info: FileInfo }[]> {
      const commentPromises = _.map(files, (info, filePath) => ({ info, path: filePath }))
        .filter((file) => file.info.isComment && file.path.indexOf(this.filePath) === 0)
        .map((file) => fs.readFile(file.path).then((body) => ({ body, info: file.info })));
      return Promise.all(commentPromises);
    }

    readFile(name: string): ReadStream {
      return createReadStream(path.resolve(this.filePath, name));
    }

    async addComment(comment: string): Promise<this> {
      const commentPath = path.resolve(this.filePath, `${Date.now()}${COMMENT_EXTENSION}`);
      await fs.writeFile(commentPath, comment);
      addFile(commentPath, await fs.stat(commentPath));
      return this;
    }

    async addFiles(files: Express.Multer.File[]): Promise<this> {
      await Promise.all(
        files.map(async (file) => {
          const destPath = path.resolve(this.filePath, file.originalname);
          await fs.rename(file.path, destPath);
          addFile(destPath, await fs.stat(destPath));
        })
      );
      return this;
    }

    static async all() {
      await Promise.all([talksReady, filesReady]);
      return talks;
    }

    static async allSorted() {
      await Promise.all([talksReady, filesReady]);
      return sortedTalks;
    }

    static async findBySlug(slug: string) {
      await Promise.all([talksReady, filesReady]);
      return talks.find((t) => t.slug === slug);
    }

    static async findById(id: string) {
      await Promise.all([talksReady, filesReady]);
      return talksById[id];
    }

    static getScheduleVersion(): null | string {
      return versionInformation;
    }

    static _getAllFiles() {
      return files;
    }
  }

  async function updateTalks(): Promise<void> {
    const v: string[] = [];
    const newTalks: Talk[] = [];
    const newTalksById: Record<string, Talk> = {};

    await Promise.all(
      scheduleJsonURLs.map(async (url) => {
        const { schedule } = await getJSON(url);
        try {
          v.push(`${schedule.conference.acronym}: ${schedule.version}`);
        } catch (e) {
          log.warn(e);
        }
        for (const day of schedule.conference.days) {
          for (const room of Object.values(day.rooms)) {
            for (const talk of room as any[]) {
              const talkObj = new Talk(talk, day.index);
              newTalks.push(talkObj);
              newTalksById[talkObj.id] = talkObj;
            }
          }
        }
      })
    );

    versionInformation = v.sort().join('; ');
    await Promise.all(newTalks.map((t) => fs.mkdir(t.filePath, { recursive: true })));
    sortedTalks = _.sortBy(newTalks, 'sortTitle');
    talks = newTalks;
    talksById = newTalksById;
    log.info('Done updating talks');
  }

  let isInitialScan = true;
  const filesReady = new Promise<void>((resolve) => {
    const fileWatcher = chokidar.watch(fileRootPath, {
      alwaysStat: true,
      ignored: '**/.DS_Store',
    });
    fileWatcher
      .on('add', addFile)
      .on('change', addFile)
      .on('unlink', removeFile)
      .on('addDir', addDir)
      .on('unlinkDir', removeDir)
      .on('error', (e) => {
        log.error(e);
        process.exit(1);
      })
      .on('ready', () => {
        log.info('Initial scan complete. Ready for changes');
        isInitialScan = false;
        resolve();
      });
  });

  const localScheduleWatcher = chokidar.watch(
    scheduleJsonURLs.filter((u) => u.protocol === 'file:').map((u) => u.pathname)
  );
  localScheduleWatcher.on('change', () => {
    log.info('Schedule changed; updating');
    talksReady = Promise.all([talksReady, filesReady])
      .then(() => updateTalks())
      .catch((e) => {
        log.warn('Error while trying to update schedule', e);
      });
  });

  // If there are remote URLs, call updateTalks() at regular intervals
  if (scheduleJsonURLs.some((u) => u.protocol !== 'file:')) {
    const interval = config.remoteScheduleUpdateInterval;
    log.info('Remote schedule URLs detected; will update every %d seconds', interval / 1000);
    setInterval(() => {
      log.info('Updating schedule on interval');
      talksReady = Promise.all([talksReady, filesReady])
        .then(() => updateTalks())
        .catch((e) => {
          log.warn('Error while trying to update schedule', e);
        });
    }, interval);
  }

  function addFile(fp: string, stats: Stats) {
    if (!isInitialScan) log.info('Added file %s', fp);
    const p = path.resolve(fp);
    const isComment = p.substr(-COMMENT_EXTENSION.length) === COMMENT_EXTENSION;
    files[p] = { stats, isComment, hash: null };
    filesLastUpdated = Date.now();
    streamHash(p)
      .then((hash) => {
        // In the meantime, the file may have been deleted, in which case
        // attempting to write the hash would throw an error.
        if (!files[p]) return;
        // It may also have been overwritten by a new version, in which case
        // this is the wrong hash we'd be writing.
        if (files[p].stats !== stats) return;
        files[p].hash = hash;
      })
      .catch((err: Error) => log.error(err, 'Error writing hash for file %s', p));
  }
  function removeFile(fp: string) {
    if (!isInitialScan) log.info('Removed file %s', fp);
    const p = path.resolve(fp);
    delete files[p];
    filesLastUpdated = Date.now();
  }
  function addDir(fp: string) {
    if (!isInitialScan) log.info('Added directory %s', fp);
    filesLastUpdated = Date.now();
  }
  function removeDir(fp: string) {
    if (!isInitialScan) log.info('Removed directory %s', fp);
    filesLastUpdated = Date.now();
  }

  return Talk;
}

export type Talk = ReturnType<typeof TalkModel>;

/** Fetches a JSON file via HTTP or from the file system */
async function getJSON(url: URL | string): Promise<any> {
  if (typeof url === 'string') url = new URL(url);
  if (url.protocol === 'file:') {
    const file = await fs.readFile(url);
    return JSON.parse(file.toString());
  } else if (url.protocol === 'http:' || url.protocol === 'https:') {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'c3lingo/c3t-drop (https://github.com/c3lingo/c3t-drop)' },
    });
    return response.json();
  }
}

/** Parses a string to a URL. If the string does not contain a protocol, it is
 * assumed to refer to a file on the file system */
function parseURL(url: string): URL {
  try {
    return new URL(url);
  } catch (err) {
    if (err instanceof TypeError && (err as any).code === 'ERR_INVALID_URL') {
      return new URL(`file://${url}`);
    } else {
      throw err;
    }
  }
}
