import { SignJWT } from 'jose';
import { type Talk } from './models/talks';

import { secret } from '../config';

const jwtSecret = new TextEncoder().encode(secret);

export interface IndexResponse {
  talks: { id: string; title: string; fileCount: number; commentCount: number; url: string }[];
  isAuthorized: boolean;
}

export async function index({
  talks,
  isAuthorized = false,
}: {
  talks: InstanceType<Talk>[];
  isAuthorized?: boolean;
}): Promise<IndexResponse> {
  return {
    talks: talks.map((talk) => ({
      id: talk.id,
      title: talk.title,
      fileCount: talk.files.length,
      commentCount: talk.commentFiles.length,
      url: `/talks/${talk.id}`,
    })),
    isAuthorized,
  };
}

export interface TalkResponse {
  isAuthorized: boolean;
  id: string;
  title: string;
  fileCount: number;
  commentCount: number;
  files: {
    name: string | null;
    redactedName: string;
    url: string | null;
    meta: { size: any; created: any; hash: any };
  }[];
  comments: { body: string; meta: { created: Date | undefined } }[] | null;
  allFilesURL: string | null;
}

export async function talk({
  talk,
  isAuthorized = false,
}: {
  talk: InstanceType<Talk>;
  isAuthorized?: boolean;
}): Promise<TalkResponse> {
  async function signPath(path: string) {
    if (!isAuthorized) return null;
    const token = await new SignJWT({ path })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('10min')
      .sign(jwtSecret);
    return `${path}?token=${token}`;
  }

  return {
    isAuthorized,
    id: talk.id,
    title: talk.title,
    fileCount: talk.files.length,
    commentCount: talk.commentFiles.length,
    files: await Promise.all(
      talk.files.map(async (file) => ({
        name: isAuthorized ? file.name : null,
        redactedName: file.redactedName,
        url: await signPath(`/talks/${talk.id}/files/${encodeURIComponent(file.name)}`),
        meta: {
          size: file.meta.stats?.size,
          created: file.meta.stats?.birthtime,
          hash: file.meta.hash,
        },
      }))
    ),
    comments: isAuthorized
      ? (await talk.getComments()).map((comment) => ({
          body: comment.body.toString(),
          meta: {
            created: comment.info.stats?.birthtime,
          },
        }))
      : null,
    allFilesURL: await signPath(`/talks/${talk.id}/files.zip`),
  };
}
