import * as archiver from 'archiver';
import * as bunyan from 'bunyan';
import * as express from 'express';
import * as i18n from 'i18n';
import * as _ from 'lodash';
import * as moment from 'moment';
import * as multer from 'multer';
import * as path from 'path';
import * as URL from 'url';

// Middleware
import * as basicAuth from 'basic-auth';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';

// Models
import TalkModel, { TalkFile } from './src/models/talks';

import { fromRoot } from './src/lib/from-root';

interface PotentiallyAuthenticatedRequest extends express.Request {
  isAuthorized?: boolean;
}
class Error404 extends Error {
  status = 404;
}

// Set up logger
const log = bunyan.createLogger({ name: 'c3t-drop-server' });

const MONTH = 30 * 24 * 60 * 60 * 1000;

// Load config
import * as config from './config';

const eventName = config.eventName;

const isProduction = process.env.NODE_ENV === 'production';
if (!isProduction) {
  log.warn('NODE_ENV is not set to production. Actual value: %s', process.env.NODE_ENV);
}

const filesBase = fromRoot('files/');

const Talk = TalkModel(config, filesBase);

const upload = multer({
  dest: path.resolve(filesBase, '.temp/'),
  limits: {
    fileSize: 50e6,
  },
});

const app = express();

// Configure internationalization
i18n.configure({
  directory: fromRoot('src/locales/'),
  locales: ['en', 'de'],
  cookie: 'lang',
});

if (isProduction) {
  app.use(helmet());
}

// Set up basic auth
function forceAuth(
  req: PotentiallyAuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction
) {
  function unauthorized(res: express.Response) {
    res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
    return res.status(401).send('<h1>Unauthorized</h1>');
  }
  if (req.isAuthorized === undefined) checkAuth(req, res);
  if (req.isAuthorized) return next();
  return unauthorized(res);
}
function checkAuth(
  req: PotentiallyAuthenticatedRequest,
  res: express.Response,
  next?: express.NextFunction
) {
  const user = basicAuth(req);
  const cookieAuth = req.cookies.auth;

  let authorized = false;
  if (!config.readCredentials) authorized = false;
  else if (
    user &&
    user.name in config.readCredentials &&
    user.pass === config.readCredentials[user.name]
  ) {
    authorized = true;
    res.cookie('auth', `${user.name}:${user.pass}`, { maxAge: MONTH, httpOnly: true });
  } else if (cookieAuth) {
    try {
      const [cookieUser, cookiePass] = cookieAuth.split(':');
      authorized =
        cookieUser in config.readCredentials && cookiePass === config.readCredentials[cookieUser];
    } catch (e) {
      log.warn(e);
    }
  }

  req.isAuthorized = authorized;
  if (next) next();
  return authorized;
}

app.use(cookieParser() as any);
app.use(checkAuth);

app.use((req, res, next) => {
  log.info('%s %s', req.method, req.url);

  if (req.query.lang) {
    log.info('Setting language to %s', req.query.lang);
    res.cookie('lang', req.query.lang, { maxAge: MONTH, httpOnly: true });
    const { pathname } = URL.parse(req.url);
    res.redirect(pathname || '/');
  } else {
    next();
  }
});
app.use(i18n.init);

app.set('views', fromRoot('src/views/'));
app.set('view engine', 'pug');

app.use('/static', express.static(fromRoot('src/static/')) as any);

app.locals.moment = moment;

app.get('/', (req: PotentiallyAuthenticatedRequest, res) => {
  const { isAuthorized } = req;
  const scheduleVersion = Talk.getScheduleVersion();
  return Talk.allSorted().then((talks) =>
    res.render('index', { talks, isAuthorized, eventName, scheduleVersion })
  );
});

app.get('/impressum', (req: PotentiallyAuthenticatedRequest, res) => {
  const { isAuthorized } = req;
  res.render('impressum', { isAuthorized, eventName });
});

function ensureExistence<T>(thing?: T | null): T {
  if (!thing) {
    const err = new Error404('Not found');
    throw err;
  }
  return thing;
}

app.get('/talks/:id', (req: PotentiallyAuthenticatedRequest, res, next) => {
  const { uploadCount, commentCount, nothingReceived } = req.query;
  const { isAuthorized } = req;
  return Talk.findById(req.params.id)
    .then(ensureExistence)
    .then(async (talk) => {
      if (req.isAuthorized) {
        const comments = await talk.getComments();
        // FIXME: This destroys the getter
        return { talk, comments };
      }
      return { talk };
    })
    .then(({ talk, comments }) => {
      res.render('talk', {
        talk,
        comments,
        uploadCount,
        commentCount,
        nothingReceived,
        isAuthorized,
        eventName,
      });
    })
    .catch(next);
});

app.get('/sign-in', forceAuth, (req, res) => {
  res.redirect('/');
});

app.post('/talks/:id/files/', upload.any() as any, (req, res, next) => {
  let requestTalk;
  const { body } = req;
  const files = req.files as Express.Multer.File[];
  if (!files.length && !body.comment) {
    log.info('Form submitted, but no files and no comment received');
    res.redirect(`/talks/${req.params.id}/?nothingReceived=true`);
    return;
  }
  log.info({ files, body }, 'Files received');
  return Talk.findById(req.params.id)
    .then(ensureExistence)
    .then((talk) => {
      requestTalk = talk;
      const tasks = [];
      if (files.length) tasks.push(talk.addFiles(files));
      if (body.comment) tasks.push(talk.addComment(body.comment));
      return Promise.all(tasks).then(() => talk);
    })
    .then((talk) => {
      res.redirect(
        `/talks/${talk.id}/?uploadCount=${files.length}&commentCount=${body.comment ? '1' : '0'}`
      );
    })
    .catch((err) => {
      log.error(err, 'Failed to add files');
      next(err);
    });
});

app.get('/talks/:id/files.zip', forceAuth, (req, res, next) => {
  return Talk.findById(req.params.id)
    .then(ensureExistence)
    .then((talk) => {
      const archive = archiver('zip');
      archive.directory(talk.filePath, '/');
      archive.on('error', next);
      res.set({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${talk.slug}.zip"`,
      });
      archive.pipe(res);
      archive.finalize();
    })
    .catch(next);
});

app.get('/talks/:id/files/:filename', forceAuth, (req, res, next) => {
  return Talk.findById(req.params.id)
    .then(ensureExistence)
    .then((talk) => {
      const file = _.find(talk.files, { name: req.params.filename }) as TalkFile;
      if (!file) {
        const error = new Error404('File not found');
        throw error;
      }
      res.sendFile(file.path);
    })
    .catch(next);
});

app.get('/talks/:id/files/', (req, res) => {
  res.redirect(`/talks/${req.params.id}/`);
});

app.use((req, res, next) => {
  log.info(`%s %s Request didn't match a route`, req.method, req.url);
  res.status(404).render('error', { status: 404 });
});
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const status: number = (err as any).status || 500;
  log.warn(err, '%s %s Error handler sent', req.method, req.url);
  res.status(status).render('error', { status });
});

app.listen(9000, () => {
  log.info('App listening on :9000');
});
