import { SignJWT } from 'jose';
import { type Talk } from './models/talks';

import { secret } from '../config';

const jwtSecret = new TextEncoder().encode(secret);

export interface IndexRouteJSON {
  talks: TalkRouteJSON[];
  isAuthorized: boolean;
}

export interface FileMetaJSON {
  size: number;
  created: string;
  hash: string;
}

export interface TalkRouteJSON {
  isAuthorized: boolean;
  id: string;
  title: string;
  fileCount: number;
  commentCount: number;
  files: {
    name: string | null;
    redactedName: string;
    url: string | null;
    meta: FileMetaJSON;
  }[];
  comments: { body: string; meta: { size: number; created: Date | undefined } }[] | null;
  allFilesURL: string | null;
}

function filterNonNull<T>(arr: (T | null | undefined)[]): T[] {
  return arr.filter((f: T | null | undefined) => f != null) as T[];
}

export async function index({
  talks,
  isAuthorized = false,
}: {
  talks: InstanceType<Talk>[];
  isAuthorized?: boolean;
}): Promise<IndexRouteJSON> {
  return {
    talks: await Promise.all(talks.map((t) => talk({ talk: t, isAuthorized }))),
    isAuthorized,
  };
}

export async function talk({
  talk,
  isAuthorized = false,
}: {
  talk: InstanceType<Talk>;
  isAuthorized?: boolean;
}): Promise<TalkRouteJSON> {
  async function signPath(path: string) {
    if (!isAuthorized) return null;
    const token = await new SignJWT({ path })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('10min')
      .sign(jwtSecret);
    return `${path}?token=${token}`;
  }

  const [files, comments] = await Promise.all([
    // files
    Promise.all(
      talk.files.map(async (file) => {
        const { stats, hash } = file.meta;
        if (!stats || !hash) return;
        return {
          name: isAuthorized ? file.name : null,
          redactedName: file.redactedName,
          url: await signPath(`/talks/${talk.id}/files/${encodeURIComponent(file.name)}`),
          meta: {
            size: stats.size,
            created: stats.birthtime,
            hash,
          },
        };
      })
    ).then(filterNonNull),

    // comments
    isAuthorized
      ? talk
          .getComments()
          .then((c) =>
            c.map((comment) => {
              const { stats, hash } = comment.info;
              if (!stats || !hash) return;
              return {
                body: comment.body.toString(),
                meta: {
                  size: stats.size,
                  created: stats.birthtime,
                  hash,
                },
              };
            })
          )
          .then(filterNonNull)
      : null,
  ]);

  let allFilesURL = null;
  if (files.length && comments?.length) {
    allFilesURL = await signPath(`/talks/${talk.id}/files.zip`);
  }

  return {
    isAuthorized,
    id: talk.id,
    title: talk.title,
    fileCount: talk.files.length,
    commentCount: talk.commentFiles.length,
    files,
    comments,
    allFilesURL,
  };
}
